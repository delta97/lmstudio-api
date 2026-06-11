import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { config } from "../config.js";

/**
 * Provider-agnostic LLM access. The rest of the pipeline talks to this module
 * and works the same whether the vision model is served by a local LM Studio
 * instance or by OpenRouter (LLM_PROVIDER=openrouter).
 */

export type LlmProvider = "lmstudio" | "openrouter";

export const provider: LlmProvider = config.llm.provider;

export const providerLabel =
  provider === "openrouter" ? "OpenRouter" : "LM Studio";

export const llmClient = new OpenAI({
  baseURL: config.llm.baseUrl,
  // LM Studio ignores the key unless auth is enabled; OpenRouter requires one.
  apiKey: config.llm.apiKey || "lm-studio",
  // OpenRouter uses these optional headers for app attribution / rankings.
  defaultHeaders:
    provider === "openrouter"
      ? {
          "HTTP-Referer": "https://github.com/delta97/lmstudio-api",
          "X-Title": "Visual QA Regression Pipeline",
        }
      : undefined,
  // Retries (with structured-output fallback) are handled in createJsonCompletion.
  maxRetries: 0,
});

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
): Promise<string> {
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
        const completion = await llmClient.chat.completions.create({
          model: opts.model ?? config.llm.model,
          temperature: opts.temperature ?? 0,
          messages: opts.messages,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error(`${providerLabel} returned an empty response.`);
        }
        return content;
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
  /**
   * LM Studio: the configured model is loaded. OpenRouter: the configured
   * model id exists in the catalog (and the API key was accepted).
   */
  modelLoaded: boolean;
  availableModels: string[];
  error?: string;
}

async function checkOpenRouterKey(): Promise<string | null> {
  if (!config.llm.apiKey) {
    return "OPENROUTER_API_KEY is not set.";
  }
  const res = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/key`, {
    headers: { Authorization: `Bearer ${config.llm.apiKey}` },
  });
  if (!res.ok) {
    return `OpenRouter rejected the API key (HTTP ${res.status}).`;
  }
  return null;
}

export async function checkHealth(): Promise<LlmHealth> {
  const base = {
    provider,
    baseUrl: config.llm.baseUrl,
    configuredModel: config.llm.model,
  };
  try {
    if (provider === "openrouter") {
      const keyError = await checkOpenRouterKey();
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
    const models = await llmClient.models.list();
    const ids = models.data.map((m) => m.id);
    return {
      ...base,
      reachable: true,
      modelLoaded: ids.includes(config.llm.model),
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
  if (provider !== "lmstudio") return;
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
