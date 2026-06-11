import { config } from "../server/config.js";
import {
  createJsonCompletion,
  parseJsonLoose,
  providerLabel,
} from "../server/services/llm.js";

/**
 * Standalone vision-analysis helper for arbitrary image attachments.
 *
 * This is intentionally separate from `src/server/services/visionTriage.ts`
 * (which is purpose-built for 3-image visual-regression triage). It shares the
 * same provider-agnostic LLM client (LM Studio or OpenRouter) but lets callers
 * pick any vision model without touching the server's configured regression
 * model.
 */

/** Default vision model for attachment analysis. Override with ANALYZE_MODEL. */
export const DEFAULT_ANALYSIS_MODEL =
  process.env.ANALYZE_MODEL ||
  (config.llm.provider === "openrouter"
    ? config.llm.model
    : "google/gemma-4-12b");

export interface ImageAnalysis {
  summary: string;
  description: string;
  tags: string[];
  contains_text: boolean;
  text_content: string;
  people_count: number;
  setting: string;
  content_category: string;
}

const ANALYSIS_JSON_SCHEMA = {
  name: "image_analysis",
  strict: false,
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One short sentence capturing what the image is.",
      },
      description: {
        type: "string",
        description:
          "A detailed, objective description of everything visible in the image.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "5-12 lowercase keyword tags describing the image.",
      },
      contains_text: {
        type: "boolean",
        description: "True if there is any readable text in the image.",
      },
      text_content: {
        type: "string",
        description:
          "Verbatim transcription of any readable text, or empty string if none.",
      },
      people_count: {
        type: "integer",
        description: "Number of distinct people visible (0 if none).",
      },
      setting: {
        type: "string",
        description:
          "Where the image appears to take place (e.g. 'indoor kitchen', 'screenshot', 'outdoor park').",
      },
      content_category: {
        type: "string",
        description:
          "Best single category, e.g. 'photo', 'screenshot', 'meme', 'document', 'selfie', 'pet', 'meme/gif'.",
      },
    },
    required: [
      "summary",
      "description",
      "tags",
      "contains_text",
      "text_content",
      "people_count",
      "setting",
      "content_category",
    ],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You are a careful image analyst. You are shown a single image (which may be a
photo, screenshot, meme, document, or a frame extracted from a video/GIF).
Describe it objectively and transcribe any visible text exactly.
Respond ONLY with JSON matching the provided schema. Do not add commentary.`;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export interface AnalyzeOptions {
  /** Vision model id (LM Studio model or OpenRouter model slug). */
  model?: string;
  /** Extra context appended to the user prompt (e.g. sender, date, caption). */
  context?: string;
}

/**
 * Analyze a single image (as a JPEG/PNG buffer) with the configured vision
 * provider. Returns a normalized {@link ImageAnalysis}.
 */
export async function analyzeImage(
  jpegOrPng: Buffer,
  mimeType: "image/jpeg" | "image/png",
  opts: AnalyzeOptions = {},
): Promise<ImageAnalysis> {
  const model = opts.model || DEFAULT_ANALYSIS_MODEL;
  const dataUrl = `data:${mimeType};base64,${jpegOrPng.toString("base64")}`;

  const userText = [
    opts.context ? `Context: ${opts.context}` : null,
    "Analyze this image and return the structured JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const { content } = await createJsonCompletion({
    model,
    temperature: 0,
    schema: ANALYSIS_JSON_SCHEMA,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  if (!content) {
    throw new Error(`${providerLabel} returned an empty response.`);
  }

  const parsed = parseJsonLoose(content) as Partial<ImageAnalysis>;
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    description: typeof parsed.description === "string" ? parsed.description : "",
    tags: asStringArray(parsed.tags),
    contains_text: Boolean(parsed.contains_text),
    text_content:
      typeof parsed.text_content === "string" ? parsed.text_content : "",
    people_count:
      typeof parsed.people_count === "number" ? parsed.people_count : 0,
    setting: typeof parsed.setting === "string" ? parsed.setting : "",
    content_category:
      typeof parsed.content_category === "string"
        ? parsed.content_category
        : "",
  };
}
