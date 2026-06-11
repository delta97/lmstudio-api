import OpenAI, { APIError } from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { config } from "../config.js";
import type { LlmUsage } from "../types.js";
import {
  getLlmConfig,
  type LlmConfigSource,
  type LlmProvider,
  type ResolvedLlmConfig,
} from "./llmConfig.js";

/**
 * Provider-agnostic LLM access. The rest of the pipeline talks to this module
 * and works the same whether the vision model is served by a local LM Studio
 * instance or by OpenRouter.
 *
 * The active backend is resolved per call via getLlmConfig() (saved settings >
 * environment > local default), so settings changed from the UI take effect
 * without a server restart.
 */

export type { LlmProvider } from "./llmConfig.js";

export function getProvider(): LlmProvider {
  return getLlmConfig().provider;
}

export function getProviderLabel(): string {
  return getProvider() === "openrouter" ? "OpenRouter" : "LM Studio";
}

let clientConfig: ResolvedLlmConfig | null = null;
let client: OpenAI | null = null;

/**
 * OpenAI-compatible client for the active backend. Rebuilt automatically when
 * the resolved settings change (invalidateLlmConfig() yields a new object).
 */
export function getLlmClient(): OpenAI {
  const llm = getLlmConfig();
  if (!client || clientConfig !== llm) {
    clientConfig = llm;
    client = new OpenAI({
      baseURL: llm.baseUrl,
      // LM Studio ignores the key unless auth is enabled; OpenRouter requires one.
      apiKey: llm.apiKey || "lm-studio",
      // OpenRouter uses these optional headers for app attribution / rankings.
      defaultHeaders:
        llm.provider === "openrouter"
          ? {
              "HTTP-Referer": "https://github.com/delta97/lmstudio-api",
              "X-Title": "Visual QA Regression Pipeline",
            }
          : undefined,
      // Retries (with structured-output fallback) are handled in createJsonCompletion.
      maxRetries: 0,
    });
  }
  return client;
}

export interface JsonSchemaSpec {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
}

function isApiError(err: unknown): err is APIError {
  return err instanceof APIError;
}

/**
 * 4xx errors complaining about the response format: the model/provider does
 * not support structured output, so we should retry with a looser format
 * rather than fail the comparison.
 */
function isFormatError(err: unknown): boolean {
  if (!isApiError(err)) return false;
  if (!err.status || err.status >= 500) return false;
  return /response_format|json_schema|structured|schema/i.test(err.message);
}

/** Network failures, 5xx and rate limits are worth retrying as-is. */
function isTransientError(err: unknown): boolean {
  if (isApiError(err)) {
    return err.status === undefined || err.status === 429 || err.status >= 500;
  }
  // Non-API errors from fetch (ECONNREFUSED, timeouts) surface as plain errors.
  return err instanceof Error && !(err instanceof SyntaxError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface JsonCompletionOptions {
  model?: string;
  messages: ChatCompletionMessageParam[];
  schema: JsonSchemaSpec;
  temperature?: number;
}

export interface JsonCompletionResult {
  content: string;
  /** Token counts (and cost, when the provider reports it) for the call. */
  usage?: LlmUsage;
}

/**
 * OpenRouter returns the metered USD cost in `usage.cost` when the request
 * asks for usage accounting (`usage: { include: true }`). The OpenAI SDK types
 * don't know about either extension, so both are typed loosely here.
 */
function extractUsage(
  completion: ChatCompletion,
  configuredModel: string,
): LlmUsage | undefined {
  const usage = completion.usage as
    | (NonNullable<ChatCompletion["usage"]> & { cost?: unknown })
    | undefined;
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    ...(typeof usage.cost === "number" ? { costUsd: usage.cost } : {}),
    model: completion.model || configuredModel,
  };
}

/**
 * Runs a chat completion that must return JSON.
 *
 * Tries `response_format: json_schema` first (best accuracy when supported),
 * then falls back to `json_object`, then to no response_format at all — the
 * caller is expected to parse leniently via {@link parseJsonLoose}. Transient
 * failures are retried with exponential backoff.
 */
export async function createJsonCompletion(
  opts: JsonCompletionOptions,
): Promise<JsonCompletionResult> {
  const llm = getLlmConfig();
  const formats: Array<
    ChatCompletionCreateParamsNonStreaming["response_format"]
  > = [
    { type: "json_schema", json_schema: opts.schema },
    { type: "json_object" },
    undefined,
  ];

  let lastError: unknown = new Error("LLM call was never attempted.");

  for (const responseFormat of formats) {
    for (let attempt = 0; attempt <= config.llm.retries; attempt++) {
      try {
        const params: ChatCompletionCreateParamsNonStreaming = {
          model: opts.model ?? llm.model,
          temperature: opts.temperature ?? 0,
          messages: opts.messages,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          // Ask OpenRouter to report the metered cost alongside token counts.
          ...(llm.provider === "openrouter"
            ? ({ usage: { include: true } } as object)
            : {}),
        };
        const completion = await getLlmClient().chat.completions.create(
          params,
        );
        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error(`${getProviderLabel()} returned an empty response.`);
        }
        return { content, usage: extractUsage(completion, llm.model) };
      } catch (err) {
        lastError = err;
        if (isFormatError(err)) break; // move on to the next, looser format
        if (!isTransientError(err) || attempt === config.llm.retries) {
          throw err;
        }
        await sleep(1000 * 2 ** attempt);
      }
    }
    if (!isFormatError(lastError)) throw lastError;
  }

  throw lastError;
}

/**
 * Parses JSON from a model response that may include reasoning preambles,
 * code fences, or surrounding prose (common when the provider/model does not
 * enforce structured output).
 */
export function parseJsonLoose(content: string): unknown {
  // Drop reasoning blocks some models emit inline.
  const trimmed = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to fenced / embedded extraction
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Could not parse JSON from model response.");
}

// ---- Health & warm-up ----

export interface LlmHealth {
  provider: LlmProvider;
  reachable: boolean;
  baseUrl: string;
  configuredModel: string;
  /** Which configuration layer is active: database (UI), env, or default. */
  source: LlmConfigSource;
  /**
   * LM Studio: the configured model is loaded. OpenRouter: the configured
   * model id exists in the catalog (and the API key was accepted).
   */
  modelLoaded: boolean;
  availableModels: string[];
  error?: string;
}

async function checkOpenRouterKey(llm: ResolvedLlmConfig): Promise<string | null> {
  if (!llm.apiKey) {
    return "No OpenRouter API key is configured (set one in Settings or via OPENROUTER_API_KEY).";
  }
  const res = await fetch(`${llm.baseUrl.replace(/\/$/, "")}/key`, {
    headers: { Authorization: `Bearer ${llm.apiKey}` },
  });
  if (!res.ok) {
    return `OpenRouter rejected the API key (HTTP ${res.status}).`;
  }
  return null;
}

export async function checkHealth(): Promise<LlmHealth> {
  const llm = getLlmConfig();
  const base = {
    provider: llm.provider,
    baseUrl: llm.baseUrl,
    configuredModel: llm.model,
    source: llm.source,
  };
  try {
    if (llm.provider === "openrouter") {
      const keyError = await checkOpenRouterKey(llm);
      if (keyError) {
        return {
          ...base,
          reachable: false,
          modelLoaded: false,
          availableModels: [],
          error: keyError,
        };
      }
    }
    const models = await getLlmClient().models.list();
    const ids = models.data.map((m) => m.id);
    return {
      ...base,
      reachable: true,
      modelLoaded: ids.includes(llm.model),
      availableModels: ids,
    };
  } catch (err) {
    return {
      ...base,
      reachable: false,
      modelLoaded: false,
      availableModels: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Warms (loads) the configured vision model via LM Studio's native API.
 * No-op for hosted providers, which have no concept of loading a model.
 */
export async function warmModel(): Promise<void> {
  if (getProvider() !== "lmstudio") return;
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
