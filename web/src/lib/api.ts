/**
 * Typed API client for the visual-regression backend (Express on :3100).
 *
 * In development all of these paths are proxied to :3100 by Vite (see
 * vite.config.ts), so we use relative URLs and rely on same-origin requests.
 *
 * The event/handler shapes match the AUTHORITATIVE backend contract in
 * src/server/services/events.ts and src/server/routes/compareUrls.ts.
 */

import type {
  CellDoneEvent,
  CellErrorEvent,
  CellStageEvent,
  CellStartEvent,
  CompareUrlsRequest,
  CompareUrlsResponse,
  HealthResponse,
  RunListItem,
  RunProgressEvent,
  RunStartEvent,
  StoredRun,
  StreamErrorPayload,
  SummaryUpdateEvent,
} from "@/lib/types";

/** Base path for API calls. Empty string = same origin (proxied in dev). */
const API_BASE = "";

class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(text || `Request to ${path} failed`, res.status);
  }
  return (await res.json()) as T;
}

/** GET /health — LM Studio reachability + loaded models. */
export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

/**
 * POST /compare-urls — blocking comparison.
 * Used as the fallback when SSE is unavailable, and by scripts.
 * Returns the report-relative variant (image URLs are NOT root-relative); use
 * the SSE stream or GET /runs/:id when root-relative image URLs are needed.
 */
export function runCompareBlocking(
  config: CompareUrlsRequest,
): Promise<CompareUrlsResponse> {
  return request<CompareUrlsResponse>("/compare-urls", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

/** GET /runs — list persisted runs for the History screen (newest first). */
export async function listRuns(): Promise<RunListItem[]> {
  const data = await request<{ runs: RunListItem[] }>("/runs");
  return data.runs;
}

/** GET /runs/:id — load a persisted run (root-relative image URLs). */
export function getRun(id: string): Promise<StoredRun> {
  return request<StoredRun>(`/runs/${encodeURIComponent(id)}`);
}

/** Per-event callbacks for {@link startRunStream}. All optional. */
export interface RunStreamHandlers {
  /** Fires for every in-progress event, after the more specific handler below. */
  onEvent?: (event: RunProgressEvent) => void;
  onRunStart?: (event: RunStartEvent) => void;
  onCellStart?: (event: CellStartEvent) => void;
  onCellStage?: (event: CellStageEvent) => void;
  onCellDone?: (event: CellDoneEvent) => void;
  onCellError?: (event: CellErrorEvent) => void;
  onSummaryUpdate?: (event: SummaryUpdateEvent) => void;
  /** Terminal "done" event: the full persisted run (root-relative image URLs). */
  onDone?: (run: StoredRun) => void;
  /**
   * Transport-level error (connection dropped) OR the server's terminal "error"
   * event (surfaced as an Error carrying the server message).
   */
  onError?: (error: Event | Error) => void;
  /** Fires once the EventSource connection opens. */
  onOpen?: () => void;
}

/** Handle returned by {@link startRunStream} for tearing down the stream. */
export interface RunStreamHandle {
  /** Close the underlying EventSource. */
  close: () => void;
}

function dispatchProgress(
  event: RunProgressEvent,
  handlers: RunStreamHandlers,
): void {
  switch (event.type) {
    case "run:start":
      handlers.onRunStart?.(event);
      break;
    case "cell:start":
      handlers.onCellStart?.(event);
      break;
    case "cell:stage":
      handlers.onCellStage?.(event);
      break;
    case "cell:done":
      handlers.onCellDone?.(event);
      break;
    case "cell:error":
      handlers.onCellError?.(event);
      break;
    case "summary:update":
      handlers.onSummaryUpdate?.(event);
      break;
  }
  handlers.onEvent?.(event);
}

/**
 * GET /compare-urls/stream — start a run and stream progress over SSE.
 *
 * EventSource only supports GET, so the run config is JSON-encoded into a
 * `config` query parameter. The backend emits NAMED SSE events
 * (`event: <type>\ndata: <json>\n\n`):
 *
 *  - run:start / cell:start / cell:stage / cell:done / cell:error /
 *    summary:update — JSON payload carries a matching `type` field.
 *  - done — payload is the full {@link StoredRun} (NO `type` field).
 *  - error — payload is {@link StreamErrorPayload} (NO `type` field).
 *
 * The connection is auto-closed on "done" and "error".
 */
export function startRunStream(
  config: CompareUrlsRequest,
  handlers: RunStreamHandlers,
): RunStreamHandle {
  const params = new URLSearchParams({ config: JSON.stringify(config) });
  const source = new EventSource(`/compare-urls/stream?${params.toString()}`);

  source.onopen = () => handlers.onOpen?.();

  const progressTypes: RunProgressEvent["type"][] = [
    "run:start",
    "cell:start",
    "cell:stage",
    "cell:done",
    "cell:error",
    "summary:update",
  ];
  for (const type of progressTypes) {
    source.addEventListener(type, (e) => {
      try {
        const event = JSON.parse((e as MessageEvent).data) as RunProgressEvent;
        dispatchProgress(event, handlers);
      } catch (err) {
        handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // Terminal "done": payload is the StoredRun itself (no `type` field).
  source.addEventListener("done", (e) => {
    try {
      const run = JSON.parse((e as MessageEvent).data) as StoredRun;
      handlers.onDone?.(run);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      source.close();
    }
  });

  // Terminal "error": payload is { error, message } (no `type` field).
  source.addEventListener("error", (e) => {
    const data = (e as MessageEvent).data;
    if (typeof data === "string" && data.length > 0) {
      try {
        const payload = JSON.parse(data) as StreamErrorPayload;
        handlers.onError?.(
          new Error(payload.message ?? payload.error ?? "Run failed"),
        );
      } catch {
        handlers.onError?.(new Error(data));
      }
      source.close();
      return;
    }
    // No data => transport-level error (e.g. connection failed to open).
    handlers.onError?.(e);
  });

  return { close: () => source.close() };
}

export { ApiError };
