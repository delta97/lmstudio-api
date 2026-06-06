import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const envSchema = z.object({
  LMSTUDIO_BASE_URL: z.string().url().default("http://localhost:1234/v1"),
  LMSTUDIO_MODEL: z.string().min(1).default("qwen/qwen3-vl-4b"),
  LMSTUDIO_API_TOKEN: z.string().optional().default(""),
  PORT: z.coerce.number().int().positive().default(3100),
  PIXEL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.001),
  MAX_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  PIXEL_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.1),
  WARM_MODEL_ON_START: booleanish,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

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
