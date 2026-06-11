import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getLlmConfig, invalidateLlmConfig } from "../services/llmConfig.js";
import {
  clearLlmSettings,
  readStoredLlmSettings,
  saveLlmSettings,
} from "../services/settingsStore.js";

/**
 * Settings API backing the UI's Settings screen.
 *
 *   GET    /settings                   — effective LLM settings + their source
 *   PUT    /settings/llm               — save provider / OpenRouter key & model
 *   DELETE /settings/llm               — clear saved settings (revert to .env)
 *   GET    /settings/openrouter/models — vision-capable OpenRouter catalog
 *
 * The raw API key is never returned; only a masked preview.
 */
export const settingsRouter = Router();

function maskApiKey(key: string): string {
  if (key.length <= 10) return "••••••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Effective settings plus per-layer detail, shaped for the Settings UI. */
function settingsPayload() {
  const llm = getLlmConfig();
  const stored = readStoredLlmSettings();
  return {
    llm: {
      provider: llm.provider,
      model: llm.model,
      baseUrl: llm.baseUrl,
      source: llm.source,
      hasApiKey: Boolean(llm.apiKey),
      apiKeyMasked:
        llm.provider === "openrouter" && llm.apiKey
          ? maskApiKey(llm.apiKey)
          : null,
      saved: stored
        ? {
            provider: stored.provider ?? null,
            openrouterModel: stored.openrouterModel ?? null,
            hasOpenrouterApiKey: Boolean(stored.openrouterApiKey),
          }
        : null,
      env: {
        provider: config.llmEnv.provider ?? null,
        openrouterModel: config.llmEnv.openrouter.modelExplicit
          ? config.llmEnv.openrouter.model
          : null,
        hasOpenrouterApiKey: Boolean(config.llmEnv.openrouter.apiKey),
      },
    },
  };
}

settingsRouter.get("/settings", (_req, res) => {
  res.json(settingsPayload());
});

const updateSchema = z.object({
  provider: z.enum(["lmstudio", "openrouter"]),
  /** Omit / empty to keep the previously saved (or .env) key. */
  openrouterApiKey: z.string().trim().max(512).optional(),
  /** Omit / empty to keep the previously saved (or .env/default) model. */
  openrouterModel: z.string().trim().max(256).optional(),
});

settingsRouter.put("/settings/llm", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid-settings",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const { provider, openrouterApiKey, openrouterModel } = parsed.data;

  if (provider === "openrouter") {
    const stored = readStoredLlmSettings();
    const effectiveKey =
      openrouterApiKey ||
      stored?.openrouterApiKey ||
      config.llmEnv.openrouter.apiKey;
    if (!effectiveKey) {
      res.status(400).json({
        error: "missing-api-key",
        message:
          "An OpenRouter API key is required — enter one or set OPENROUTER_API_KEY.",
      });
      return;
    }
  }

  saveLlmSettings({
    provider,
    ...(openrouterApiKey ? { openrouterApiKey } : {}),
    ...(openrouterModel ? { openrouterModel } : {}),
  });
  invalidateLlmConfig();
  res.json(settingsPayload());
});

settingsRouter.delete("/settings/llm", (_req, res) => {
  clearLlmSettings();
  invalidateLlmConfig();
  res.json(settingsPayload());
});

interface OpenRouterCatalogModel {
  id?: unknown;
  name?: unknown;
  architecture?: { input_modalities?: unknown };
}

settingsRouter.get("/settings/openrouter/models", async (_req, res) => {
  const baseUrl = config.llmEnv.openrouter.baseUrl.replace(/\/$/, "");
  try {
    // The catalog endpoint is public — no API key required.
    const catalog = await fetch(`${baseUrl}/models`);
    if (!catalog.ok) {
      res.status(502).json({
        error: "openrouter-unreachable",
        message: `OpenRouter returned HTTP ${catalog.status} for the model catalog.`,
      });
      return;
    }
    const body = (await catalog.json()) as { data?: OpenRouterCatalogModel[] };
    const models = (body.data ?? [])
      .filter((m): m is OpenRouterCatalogModel & { id: string } => {
        if (typeof m.id !== "string") return false;
        const modalities = m.architecture?.input_modalities;
        // Only vision-capable models are usable for screenshot triage.
        return Array.isArray(modalities) && modalities.includes("image");
      })
      .map((m) => ({
        id: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    res.json({ models });
  } catch (err) {
    res.status(502).json({
      error: "openrouter-unreachable",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
