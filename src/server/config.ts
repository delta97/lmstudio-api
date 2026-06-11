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
  /**
   * How many comparison jobs may run simultaneously. Each running job owns a
   * Playwright browser, so this is intentionally small; extra jobs queue.
   */
  MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(8).default(2),
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

/** True when the variable is defined (non-empty) in the environment / .env. */
function envDefined(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
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

export const config = {
  /** Tuning shared by both LLM backends. */
  llm: {
    maxImageDim: env.AI_MAX_IMAGE_DIM,
    retries: env.AI_RETRIES,
    reviewConfidence: env.AI_REVIEW_CONFIDENCE,
  },
  /**
   * Raw per-backend settings from the environment. The ACTIVE backend is
   * resolved per request by services/llmConfig.ts, which layers settings
   * saved from the UI (SQLite) on top of these.
   */
  llmEnv: {
    /** LLM_PROVIDER, but only when explicitly set in the environment. */
    provider: envDefined("LLM_PROVIDER") ? env.LLM_PROVIDER : undefined,
    lmstudio: {
      baseUrl: env.LMSTUDIO_BASE_URL,
      model: env.LMSTUDIO_MODEL,
      apiToken: env.LMSTUDIO_API_TOKEN,
    },
    openrouter: {
      baseUrl: env.OPENROUTER_BASE_URL,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
      /** True when OPENROUTER_MODEL is set in the environment (vs. default). */
      modelExplicit: envDefined("OPENROUTER_MODEL"),
    },
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
  jobs: {
    maxConcurrent: env.MAX_CONCURRENT_JOBS,
  },
  diff: {
    pixelThreshold: env.PIXEL_THRESHOLD,
    maxRatio: env.MAX_RATIO,
    pixelMatchThreshold: env.PIXEL_MATCH_THRESHOLD,
  },
  warmModelOnStart: env.WARM_MODEL_ON_START,
} as const;

export type AppConfig = typeof config;
