import { config } from "../config.js";
import {
  readStoredLlmSettings,
  type StoredLlmSettings,
} from "./settingsStore.js";

/**
 * Resolves which LLM backend is active, layering three sources by priority:
 *
 *   1. "database" — settings saved from the UI (SQLite, data/settings.db)
 *   2. "env"      — the environment / .env file (LLM_PROVIDER, or OpenRouter
 *                   credentials being defined selects OpenRouter)
 *   3. "default"  — a locally running LM Studio model
 *
 * The result is cached; call invalidateLlmConfig() after saving settings so
 * the next request picks up the change without a server restart.
 */

export type LlmProvider = "lmstudio" | "openrouter";
export type LlmConfigSource = "database" | "env" | "default";

export interface ResolvedLlmConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Which configuration layer produced these settings. */
  source: LlmConfigSource;
}

function openRouterConfig(
  source: LlmConfigSource,
  stored?: StoredLlmSettings,
): ResolvedLlmConfig {
  return {
    provider: "openrouter",
    baseUrl: config.llmEnv.openrouter.baseUrl,
    model: stored?.openrouterModel || config.llmEnv.openrouter.model,
    apiKey: stored?.openrouterApiKey || config.llmEnv.openrouter.apiKey,
    source,
  };
}

function lmStudioConfig(source: LlmConfigSource): ResolvedLlmConfig {
  return {
    provider: "lmstudio",
    baseUrl: config.llmEnv.lmstudio.baseUrl,
    model: config.llmEnv.lmstudio.model,
    apiKey: config.llmEnv.lmstudio.apiToken,
    source,
  };
}

function resolve(): ResolvedLlmConfig {
  // 1. Settings saved from the UI win over everything else.
  const stored = readStoredLlmSettings();
  if (stored?.provider === "openrouter")
    return openRouterConfig("database", stored);
  if (stored?.provider === "lmstudio") return lmStudioConfig("database");
  // Saved OpenRouter credentials without an explicit provider (older saves)
  // still mean the user configured OpenRouter from the UI.
  if (stored?.openrouterApiKey) return openRouterConfig("database", stored);

  // 2. Environment: an explicit LLM_PROVIDER wins; otherwise defining the
  //    OpenRouter key or model in .env selects OpenRouter.
  if (config.llmEnv.provider === "openrouter") return openRouterConfig("env");
  if (config.llmEnv.provider === "lmstudio") return lmStudioConfig("env");
  if (
    config.llmEnv.openrouter.apiKey ||
    config.llmEnv.openrouter.modelExplicit
  ) {
    return openRouterConfig("env");
  }

  // 3. Fallback: a locally running LM Studio model.
  return lmStudioConfig("default");
}

let cached: ResolvedLlmConfig | null = null;

/** The currently active LLM settings (cached until invalidated). */
export function getLlmConfig(): ResolvedLlmConfig {
  if (!cached) cached = resolve();
  return cached;
}

/** Drops the cache so the next getLlmConfig() re-reads the settings store. */
export function invalidateLlmConfig(): void {
  cached = null;
}
