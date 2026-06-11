import sharp from "sharp";
import { config } from "../config.js";
import type { AiChange, AiVerdict, PixelResult } from "../types.js";
import { createJsonCompletion, parseJsonLoose, providerLabel } from "./llm.js";

const VERDICT_JSON_SCHEMA = {
  name: "visual_regression_verdict",
  strict: true,
  // Property order matters for generation quality: the model enumerates the
  // concrete changes and summary BEFORE committing to a verdict, which forces
  // evidence-first reasoning instead of post-hoc justification.
  schema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        description:
          "Every visible difference between BASELINE and CURRENT, including ones you classify as acceptable noise. Empty only if the images are visually identical.",
        items: {
          type: "object",
          properties: {
            region: {
              type: "string",
              description:
                "Where in the UI the change is (e.g. 'header', 'top-right button').",
            },
            description: {
              type: "string",
              description:
                "What changed, and whether it is a real regression or acceptable noise/dynamic content.",
            },
            severity: {
              type: "string",
              enum: ["low", "medium", "high"],
              description:
                "high = broken/missing content or functionality; medium = clearly visible unintended change; low = subtle cosmetic difference or probable noise.",
            },
          },
          required: ["region", "description", "severity"],
          additionalProperties: false,
        },
      },
      summary: {
        type: "string",
        description: "One or two sentences explaining the verdict.",
      },
      regression: {
        type: "boolean",
        description:
          "true if AT LEAST ONE difference is a real, meaningful visual regression a human reviewer would care about; false if ALL differences are acceptable noise (anti-aliasing, sub-pixel font rendering, dynamic timestamps/content).",
      },
      confidence: {
        type: "number",
        description:
          "Calibrated confidence in the verdict, 0 to 1. Use 0.9+ only when the evidence is unambiguous; use below 0.6 when the images are hard to read or the changes could plausibly be expected dynamic content.",
      },
    },
    required: ["changes", "summary", "regression", "confidence"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You are a meticulous senior visual QA engineer triaging automated screenshot comparisons.
You are given three images of the same UI screen, in this order:
1. BASELINE - the expected, known-good screenshot.
2. CURRENT - the latest screenshot under test.
3. DIFF - a map of changed pixels drawn in bright red over a dimmed baseline (yellow marks anti-aliasing noise).

Follow this method, in order:
1. Compare BASELINE and CURRENT directly, region by region (header, navigation, main content, sidebars, footer). Use the DIFF map and the changed-area coordinates in the user message only to know WHERE to look - never judge from the DIFF alone, because dynamic-but-acceptable content also lights up red.
2. For each changed area, identify exactly WHAT changed: text content, color, size, position, visibility, images, spacing, overflow/clipping.
3. Classify each change:
   - ACCEPTABLE NOISE (not a regression): anti-aliasing, sub-pixel font hinting/kerning, minor compression artifacts, 1px rendering shifts, gradient banding, scrollbar differences, and anything the reviewer context flags as dynamic or expected (timestamps, counters, randomized data, ads, carousels).
   - REAL REGRESSION: missing/added/moved/resized elements, color or font changes, layout or alignment shifts, broken or missing images, overlapping/clipped/truncated text, wrong copy, broken interactive states - any change that would degrade the user experience or that a designer would flag.
4. Set regression=true if AT LEAST ONE change is a real regression; false only if ALL changes are acceptable noise or expected dynamic content.

Be precise: report what you actually see, not what the diff statistics suggest. If text is too small to read confidently, say so and lower your confidence.
Respond ONLY with JSON matching the provided schema.`;

function dataUrl(base64Png: string): string {
  return `data:image/png;base64,${base64Png}`;
}

/**
 * Caps the longest image edge before sending it to the model. Vision models
 * resample large inputs unpredictably; pre-scaling with a quality filter keeps
 * the result legible and consistent across providers.
 */
async function prepareImage(base64Png: string): Promise<string> {
  const maxDim = config.llm.maxImageDim;
  if (!maxDim) return base64Png;
  const input = Buffer.from(base64Png, "base64");
  const meta = await sharp(input).metadata();
  if ((meta.width ?? 0) <= maxDim && (meta.height ?? 0) <= maxDim) {
    return base64Png;
  }
  const out = await sharp(input)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return out.toString("base64");
}

/** Human-readable position of a region within the screenshot (thirds grid). */
function positionLabel(
  region: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): string {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const vertical = cy < imageHeight / 3 ? "top" : cy < (2 * imageHeight) / 3 ? "middle" : "bottom";
  const horizontal = cx < imageWidth / 3 ? "left" : cx < (2 * imageWidth) / 3 ? "center" : "right";
  return `${vertical}-${horizontal}`;
}

function describeDiffRegions(pixel: PixelResult): string | null {
  if (pixel.diffRegions.length === 0) return null;
  const lines = pixel.diffRegions.map((r, i) => {
    const pos = positionLabel(r, pixel.width, pixel.height);
    return `  ${i + 1}. ${pos}: x=${r.x} y=${r.y} ${r.width}x${r.height}px (${r.diffPixels.toLocaleString("en-US")} changed pixels)`;
  });
  return [
    "Changed areas detected by the pixel diff (approximate bounding boxes, largest first):",
    ...lines,
  ].join("\n");
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  // Some models answer on a 0-100 scale despite instructions.
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, normalized));
}

const SEVERITIES = new Set(["low", "medium", "high"]);

function normalizeChanges(value: unknown): AiChange[] {
  if (!Array.isArray(value)) return [];
  const changes: AiChange[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.region !== "string" || typeof c.description !== "string") {
      continue;
    }
    const severity =
      typeof c.severity === "string" && SEVERITIES.has(c.severity)
        ? (c.severity as AiChange["severity"])
        : "medium";
    changes.push({ region: c.region, description: c.description, severity });
  }
  return changes;
}

export interface TriageInput {
  baselinePng: string;
  currentPng: string;
  diffPng: string;
  pixel: PixelResult;
  context?: string;
}

export async function triageWithVision(input: TriageInput): Promise<AiVerdict> {
  const { pixel } = input;
  const userText = [
    `Screenshot size: ${pixel.width}x${pixel.height}px.`,
    `The pixel diff covers ${(pixel.diffRatio * 100).toFixed(3)}% of the image (${pixel.diffPixels.toLocaleString("en-US")} of ${pixel.totalPixels.toLocaleString("en-US")} pixels).`,
    pixel.sizeMismatch
      ? "WARNING: baseline and current screenshots had different dimensions; current was resized to match, which can itself cause widespread pixel differences. Focus on structural/content changes rather than uniform scaling artifacts."
      : null,
    describeDiffRegions(pixel),
    input.context ? `Reviewer context: ${input.context}` : null,
    "Image 1 is BASELINE, image 2 is CURRENT, image 3 is the DIFF map.",
    "List every visible difference, classify each one, then decide whether CURRENT contains a real visual regression.",
  ]
    .filter(Boolean)
    .join("\n");

  const [baselinePng, currentPng, diffPng] = await Promise.all([
    prepareImage(input.baselinePng),
    prepareImage(input.currentPng),
    prepareImage(input.diffPng),
  ]);

  const content = await createJsonCompletion({
    temperature: 0,
    schema: VERDICT_JSON_SCHEMA,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl(baselinePng) } },
          { type: "image_url", image_url: { url: dataUrl(currentPng) } },
          { type: "image_url", image_url: { url: dataUrl(diffPng) } },
        ],
      },
    ],
  });

  const parsed = parseJsonLoose(content) as Partial<AiVerdict>;
  if (typeof parsed.regression !== "boolean") {
    throw new Error(
      `${providerLabel} response did not include a boolean "regression" verdict.`,
    );
  }
  return {
    regression: parsed.regression,
    confidence: clampConfidence(parsed.confidence),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    changes: normalizeChanges(parsed.changes),
  };
}
