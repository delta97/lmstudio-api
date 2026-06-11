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
  JobSnapshot,
  JobStateEvent,
  RunListItem,
  RunPhaseEvent,
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

// ---- Comparison jobs (POST /jobs, GET /jobs, GET /jobs/:id/stream) ----

/** POST /jobs — start a comparison job server-side; returns immediately. */
export async function startJob(
  config: CompareUrlsRequest,
): Promise<JobSnapshot> {
  const data = await request<{ job: JobSnapshot }>("/jobs", {
    method: "POST",
    body: JSON.stringify(config),
  });
  return data.job;
}

/** GET /jobs — all known jobs, newest first. */
export async function listJobs(): Promise<JobSnapshot[]> {
  const data = await request<{ jobs: JobSnapshot[] }>("/jobs");
  return data.jobs;
}

/** GET /jobs/:id — snapshot of one job (used as the polling fallback). */
export async function getJobSnapshot(id: string): Promise<JobSnapshot> {
  const data = await request<{ job: JobSnapshot }>(
    `/jobs/${encodeURIComponent(id)}`,
  );
  return data.job;
}

/** Per-event callbacks for {@link startRunStream} / {@link attachJobStream}. */
export interface RunStreamHandlers {
  /** Job lifecycle transitions (queued → running → done/error). Jobs only. */
  onJobState?: (event: JobStateEvent) => void;
  /** Fires for every in-progress event, after the more specific handler below. */
  onEvent?: (event: RunProgressEvent) => void;
  onRunStart?: (event: RunStartEvent) => void;
  onRunPhase?: (event: RunPhaseEvent) => void;
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
    case "run:phase":
      handlers.onRunPhase?.(event);
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
 * Opens an SSE connection that follows the run-event protocol shared by
 * GET /compare-urls/stream and GET /jobs/:id/stream. The backend emits NAMED
 * SSE events (`event: <type>\ndata: <json>\n\n`):
 *
 *  - run:start / cell:start / cell:stage / cell:done / cell:error /
 *    summary:update — JSON payload carries a matching `type` field.
 *  - job:state — job lifecycle transitions (job streams only).
 *  - done — payload is the full {@link StoredRun} (NO `type` field).
 *  - error — payload is {@link StreamErrorPayload} (NO `type` field).
 *
 * The connection is auto-closed on "done" and "error".
 */
function openRunEventSource(
  url: string,
  handlers: RunStreamHandlers,
): RunStreamHandle {
  const source = new EventSource(url);

  source.onopen = () => handlers.onOpen?.();

  source.addEventListener("job:state", (e) => {
    try {
      const event = JSON.parse((e as MessageEvent).data) as JobStateEvent;
      handlers.onJobState?.(event);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const progressTypes: RunProgressEvent["type"][] = [
    "run:start",
    "run:phase",
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

/**
 * GET /compare-urls/stream — start a one-shot run tied to this connection.
 * EventSource only supports GET, so the run config is JSON-encoded into a
 * `config` query parameter. Prefer {@link startJob} + {@link attachJobStream},
 * which survive disconnects and support concurrent runs.
 */
export function startRunStream(
  config: CompareUrlsRequest,
  handlers: RunStreamHandlers,
): RunStreamHandle {
  const params = new URLSearchParams({ config: JSON.stringify(config) });
  return openRunEventSource(
    `/compare-urls/stream?${params.toString()}`,
    handlers,
  );
}

/**
 * GET /jobs/:id/stream — attach to a job started via {@link startJob}. The
 * server replays the job's full event history first, so attaching late (or
 * re-attaching after a reload) still yields a complete picture.
 */
export function attachJobStream(
  jobId: string,
  handlers: RunStreamHandlers,
): RunStreamHandle {
  return openRunEventSource(
    `/jobs/${encodeURIComponent(jobId)}/stream`,
    handlers,
  );
}

export { ApiError };
