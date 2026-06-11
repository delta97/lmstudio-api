import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const envSchema = z.object({
  /** Which backend serves the vision model: a local LM Studio server or OpenRouter. */
  LLM_PROVIDER: z.enum(["lmstudio", "openrouter"]).default("lmstudio"),

  // ---- LM Studio (local) ----
  LMSTUDIO_BASE_URL: z.string().url().default("http://localhost:1234/v1"),
  LMSTUDIO_MODEL: z.string().min(1).default("qwen/qwen3-vl-4b"),
  LMSTUDIO_API_TOKEN: z.string().optional().default(""),

  // ---- OpenRouter (hosted) ----
  OPENROUTER_BASE_URL: z
    .string()
    .url()
    .default("https://openrouter.ai/api/v1"),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().min(1).default("google/gemini-2.5-flash"),

  PORT: z.coerce.number().int().positive().default(3100),
  PIXEL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.001),
  MAX_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  PIXEL_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.1),

  /**
   * Longest image edge (px) sent to the vision model; larger screenshots are
   * downscaled so the model sees a predictable resolution instead of applying
   * its own (often lossier) resampling. 0 disables downscaling.
   */
  AI_MAX_IMAGE_DIM: z.coerce.number().int().min(0).default(2048),
  /** Retries for transient model-call failures (network, 5xx, 429). */
  AI_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * AI verdicts with confidence below this are flagged needsReview=true so a
   * human double-checks borderline calls instead of trusting them blindly.
   */
  AI_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),

  WARM_MODEL_ON_START: booleanish,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

if (env.LLM_PROVIDER === "openrouter" && !env.OPENROUTER_API_KEY) {
  console.warn(
    "LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is not set — model calls will fail until a key is provided.",
  );
}

/**
 * Derives the LM Studio native API root (e.g. http://localhost:1234/api/v1)
 * from the OpenAI-compatible base URL (http://localhost:1234/v1).
 */
function deriveNativeApiBase(openAiBaseUrl: string): string {
  const url = new URL(openAiBaseUrl);
  url.pathname = "/api/v1";
  return url.toString().replace(/\/$/, "");
}

const isOpenRouter = env.LLM_PROVIDER === "openrouter";

export const config = {
  /** Active LLM backend, resolved from LLM_PROVIDER. */
  llm: {
    provider: env.LLM_PROVIDER,
    baseUrl: isOpenRouter ? env.OPENROUTER_BASE_URL : env.LMSTUDIO_BASE_URL,
    model: isOpenRouter ? env.OPENROUTER_MODEL : env.LMSTUDIO_MODEL,
    apiKey: isOpenRouter ? env.OPENROUTER_API_KEY : env.LMSTUDIO_API_TOKEN,
    maxImageDim: env.AI_MAX_IMAGE_DIM,
    retries: env.AI_RETRIES,
    reviewConfidence: env.AI_REVIEW_CONFIDENCE,
  },
  /** LM Studio-specific settings (native API for model warm-up). */
  lmStudio: {
    baseUrl: env.LMSTUDIO_BASE_URL,
    nativeApiBase: deriveNativeApiBase(env.LMSTUDIO_BASE_URL),
    model: env.LMSTUDIO_MODEL,
    apiToken: env.LMSTUDIO_API_TOKEN,
  },
  server: {
    port: env.PORT,
  },
  diff: {
    pixelThreshold: env.PIXEL_THRESHOLD,
    maxRatio: env.MAX_RATIO,
    pixelMatchThreshold: env.PIXEL_MATCH_THRESHOLD,
  },
  warmModelOnStart: env.WARM_MODEL_ON_START,
} as const;

export type AppConfig = typeof config;
