import OpenAI from "openai";
import { config } from "../config.js";
import type { AiVerdict } from "../types.js";

const client = new OpenAI({
  baseURL: config.lmStudio.baseUrl,
  // LM Studio ignores the key unless auth is enabled; send the token if present.
  apiKey: config.lmStudio.apiToken || "lm-studio",
});

const VERDICT_JSON_SCHEMA = {
  name: "visual_regression_verdict",
  strict: true,
  schema: {
    type: "object",
    properties: {
      regression: {
        type: "boolean",
        description:
          "true if the differences represent a real, meaningful visual regression a human reviewer would care about; false if they are acceptable noise (anti-aliasing, sub-pixel font rendering, dynamic timestamps/content).",
      },
      confidence: {
        type: "number",
        description: "Confidence in the verdict, from 0 to 1.",
      },
      summary: {
        type: "string",
        description: "One or two sentences explaining the verdict.",
      },
      changes: {
        type: "array",
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
              description: "What changed.",
            },
            severity: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
          required: ["region", "description", "severity"],
          additionalProperties: false,
        },
      },
    },
    required: ["regression", "confidence", "summary", "changes"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You are a meticulous visual QA reviewer for automated regression testing.
You are given three images of the same UI screen:
1. BASELINE - the expected, known-good screenshot.
2. CURRENT - the latest screenshot under test.
3. DIFF - a map highlighting (in red) the pixels that changed between baseline and current.

Decide whether CURRENT contains a REAL visual regression versus acceptable rendering noise.
Treat as acceptable (regression=false): anti-aliasing, sub-pixel font hinting, minor compression artifacts,
and content the user flagged as dynamic (timestamps, counters, randomized data, carousels).
Treat as a regression (regression=true): missing/added/moved elements, color or layout changes,
broken images, overlapping/clipped text, or any change that would degrade the user experience.
Respond ONLY with JSON matching the provided schema.`;

function dataUrl(base64Png: string): string {
  return `data:image/png;base64,${base64Png}`;
}

export interface TriageInput {
  baselinePng: string;
  currentPng: string;
  diffPng: string;
  diffRatio: number;
  context?: string;
}

export async function triageWithVision(input: TriageInput): Promise<AiVerdict> {
  const userText = [
    `The pixel diff covers ${(input.diffRatio * 100).toFixed(3)}% of the image.`,
    input.context ? `Reviewer context: ${input.context}` : null,
    "Image 1 is BASELINE, image 2 is CURRENT, image 3 is the DIFF map.",
    "Determine whether CURRENT has a real visual regression.",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await client.chat.completions.create({
    model: config.lmStudio.model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl(input.baselinePng) } },
          { type: "image_url", image_url: { url: dataUrl(input.currentPng) } },
          { type: "image_url", image_url: { url: dataUrl(input.diffPng) } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: VERDICT_JSON_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LM Studio returned an empty response.");
  }

  const parsed = JSON.parse(content) as AiVerdict;
  return {
    regression: Boolean(parsed.regression),
    confidence:
      typeof parsed.confidence === "number" ? parsed.confidence : 0,
    summary: parsed.summary ?? "",
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
  };
}

export interface LmStudioHealth {
  reachable: boolean;
  baseUrl: string;
  configuredModel: string;
  modelLoaded: boolean;
  availableModels: string[];
  error?: string;
}

export async function checkHealth(): Promise<LmStudioHealth> {
  try {
    const models = await client.models.list();
    const ids = models.data.map((m) => m.id);
    return {
      reachable: true,
      baseUrl: config.lmStudio.baseUrl,
      configuredModel: config.lmStudio.model,
      modelLoaded: ids.includes(config.lmStudio.model),
      availableModels: ids,
    };
  } catch (err) {
    return {
      reachable: false,
      baseUrl: config.lmStudio.baseUrl,
      configuredModel: config.lmStudio.model,
      modelLoaded: false,
      availableModels: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Warms (loads) the configured vision model via LM Studio's native API. */
export async function warmModel(): Promise<void> {
  const url = `${config.lmStudio.nativeApiBase}/models/load`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.lmStudio.apiToken) {
    headers["Authorization"] = `Bearer ${config.lmStudio.apiToken}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: config.lmStudio.model }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to warm model (${res.status}): ${await res.text()}`,
    );
  }
}
