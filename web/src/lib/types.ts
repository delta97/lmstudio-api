/**
 * Shared API types for the visual-regression UI.
 *
 * SOURCE OF TRUTH: ../../../src/server/types.ts, ../../../src/server/services/events.ts,
 * and ../../../src/server/services/runStore.ts.
 *
 * These are hand-mirrored from the backend rather than imported directly because
 * the backend files pull in `zod` / Node modules and live outside this Vite
 * project's rootDir. Keep them in sync with the backend whenever it changes.
 */

// ---- Pixel diff ----

export interface PixelResult {
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  width: number;
  height: number;
  /** True if baseline and current had different dimensions (current was resized). */
  sizeMismatch: boolean;
}

// ---- AI vision verdict ----

export interface AiChange {
  region: string;
  description: string;
  severity: "low" | "medium" | "high";
}

/**
 * Token/cost accounting for the LLM call(s) behind one verdict. `costUsd` is
 * reported by hosted providers that meter spend (OpenRouter); it is absent for
 * local backends (LM Studio), where inference is free.
 */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Spend in USD as reported by the provider, when available. */
  costUsd?: number;
  /** The model that actually served the call. */
  model: string;
}

export interface AiVerdict {
  regression: boolean;
  confidence: number;
  summary: string;
  changes: AiChange[];
  /** Token counts and provider-reported cost for this verdict's model call. */
  usage?: LlmUsage;
  /** Present when the model call failed and the result needs human review. */
  error?: string;
}

export type Verdict = "pass" | "fail";
export type DecidedBy = "pixel-pass" | "pixel-fail" | "ai" | "ai-error";

/** Severity ordering helper (high first). */
export const SEVERITY_ORDER: Record<AiChange["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ---- URL comparison request (POST /compare-urls, GET /compare-urls/stream) ----

export interface Breakpoint {
  name: string;
  width: number;
  height: number;
}

export interface UrlPair {
  name?: string;
  baselineUrl: string;
  currentUrl: string;
  context?: string;
}

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

export interface CompareUrlsRequest {
  /** Shorthand for a single pair. */
  baselineUrl?: string;
  currentUrl?: string;
  /** Or provide many pairs at once. */
  pairs?: UrlPair[];
  breakpoints?: Breakpoint[];
  fullPage?: boolean;
  waitUntil?: WaitUntil;
  waitMs?: number;
  /** Run a headed browser (helps with some bot walls). Defaults to headless. */
  headless?: boolean;
  /** Override the browser User-Agent. Defaults to a realistic desktop Chrome UA. */
  userAgent?: string;
  locale?: string;
  /** Extra HTTP headers sent with every request (e.g. cookies, auth). */
  headers?: Record<string, string>;
  pixelThreshold?: number;
  /**
   * Defaults to 1 for URL comparisons so the vision model always describes
   * differences instead of short-circuiting to a pixel-fail.
   */
  maxRatio?: number;
  context?: string;
}

// ---- URL comparison results ----

export interface UrlComparisonItem {
  name: string;
  breakpoint: string;
  width: number;
  height: number;
  baselineUrl: string;
  currentUrl: string;
  verdict: Verdict | "error";
  decidedBy: DecidedBy | "error";
  diffRatio: number;
  sizeMismatch: boolean;
  needsReview: boolean;
  ai: AiVerdict | null;
  error?: string;
  /** Root-relative image URLs (/reports/<id>/images/<file>) in persisted runs. */
  images?: { baseline: string; current: string; diff: string };
}

export interface CompareUrlsSummary {
  comparisons: number;
  different: number;
  errors: number;
  changesFlagged: number;
  /** Number of comparisons that used an AI vision call. */
  aiCalls?: number;
  /** Total LLM tokens consumed across all AI calls in the run. */
  totalTokens?: number;
  /** Total provider-reported spend in USD (0 for local providers). */
  costUsd?: number;
}

export interface CompareUrlsResponse {
  reportDir: string;
  reportHtml: string;
  reportMd: string;
  summary: CompareUrlsSummary;
  results: UrlComparisonItem[];
}

/**
 * Persisted run record returned by the SSE "done" event and GET /runs/:id.
 * Image URLs are root-relative.
 */
export type StoredRun = CompareUrlsResponse & {
  id: string;
  generatedAt: string;
};

// ---- Health (GET /health) ----

export type LlmProvider = "lmstudio" | "openrouter";

export interface LlmHealth {
  /** Active LLM backend serving the vision model. */
  provider: LlmProvider;
  /** Whether the provider endpoint is reachable (and the key valid). */
  reachable: boolean;
  baseUrl: string;
  /** The configured vision model id. */
  configuredModel: string;
  /** Loaded (LM Studio) or available in the catalog (OpenRouter). */
  modelLoaded: boolean;
  /** Model ids currently available at the provider. */
  availableModels: string[];
  /** Present when the provider could not be reached. */
  error?: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  provider: LlmProvider;
  llm: LlmHealth;
  /** Deprecated alias of `llm`, kept for older clients. */
  lmStudio: LlmHealth;
}

// ---- Run history (GET /runs, GET /runs/:id) ----

/** Lightweight run descriptor for the History list (newest first). */
export interface RunListItem {
  id: string;
  generatedAt: string;
  summary: CompareUrlsSummary;
  pairs: { name: string; baselineUrl: string; currentUrl: string }[];
}

/** Envelope returned by GET /runs. */
export interface RunsListResponse {
  runs: RunListItem[];
}

// ---- SSE progress stream (GET /compare-urls/stream) ----
//
// AUTHORITATIVE SOURCE: src/server/services/events.ts (in-progress events) and
// the GET /compare-urls/stream handler in src/server/routes/compareUrls.ts
// (final "done"/"error" events).
//
// Cells are identified by (name, breakpoint) — there is NO CellId object and NO
// runId on run:start. Payloads below match the exact server shapes.

/** Stages a single (pair x breakpoint) cell moves through during a run. */
export type CellStage =
  | "capturing-baseline"
  | "capturing-current"
  | "pixel-diffing"
  | "ai-reviewing";

/** Identity of a comparison pair, as advertised on run:start. */
export interface EventPair {
  name: string;
  baselineUrl: string;
  currentUrl: string;
}

/** A breakpoint as advertised on run:start. */
export interface EventBreakpoint {
  name: string;
  width: number;
  height: number;
}

/** Emitted once, before any work begins. */
export interface RunStartEvent {
  type: "run:start";
  totalCells: number;
  pairs: EventPair[];
  breakpoints: EventBreakpoint[];
}

/**
 * Run-level phases bracketing the per-cell work: launching the browser before
 * any capture, the capture/diff/review loop, and report generation afterwards.
 */
export type RunPhase = "launching" | "capturing" | "generating-report";

/** Emitted when the run as a whole moves into a new phase. */
export interface RunPhaseEvent {
  type: "run:phase";
  phase: RunPhase;
}

/** Emitted when a cell begins processing. */
export interface CellStartEvent {
  type: "cell:start";
  name: string;
  breakpoint: string;
  width: number;
  height: number;
}

/** Emitted as a cell transitions between observable stages. */
export interface CellStageEvent {
  type: "cell:stage";
  name: string;
  breakpoint: string;
  stage: CellStage;
}

/**
 * Small, directly-embeddable JPEG DATA URLs usable as `<img src>` so the UI can
 * show thumbnails live before the full-resolution report is written to disk.
 */
export interface CellThumbnails {
  baseline: string;
  current: string;
  diff: string;
}

/** Emitted when a cell finishes successfully. */
export interface CellDoneEvent {
  type: "cell:done";
  /** The comparison result WITHOUT on-disk image paths (not yet persisted). */
  item: Omit<UrlComparisonItem, "images">;
  thumbnails: CellThumbnails;
}

/** Emitted when a cell fails (capture/diff error). */
export interface CellErrorEvent {
  type: "cell:error";
  name: string;
  breakpoint: string;
  error: string;
}

/** Emitted after each cell with cumulative totals so far. */
export interface SummaryUpdateEvent {
  type: "summary:update";
  comparisons: number;
  different: number;
  errors: number;
  changesFlagged: number;
  /** Cells that needed an AI vision call so far. */
  aiCalls: number;
  /** Cumulative LLM tokens consumed by those calls. */
  totalTokens: number;
  /** Cumulative provider-reported spend in USD (0 for local providers). */
  costUsd: number;
}

/**
 * Discriminated union of every in-progress event (each carries a `type` field
 * in its JSON payload). The terminal "done" event's payload is a {@link StoredRun}
 * (no `type` field) and the "error" event's payload is {@link StreamErrorPayload};
 * both are surfaced through dedicated handlers keyed off the SSE event name.
 */
export type RunProgressEvent =
  | RunStartEvent
  | RunPhaseEvent
  | CellStartEvent
  | CellStageEvent
  | CellDoneEvent
  | CellErrorEvent
  | SummaryUpdateEvent;

export type RunEventType = RunProgressEvent["type"];

/** Payload of the terminal SSE "error" event. */
export interface StreamErrorPayload {
  error: string;
  message?: string;
}

/** A cell key derived from (name, breakpoint). */
export function cellKey(name: string, breakpoint: string): string {
  return `${name}|${breakpoint}`;
}

// ---- Comparison jobs (POST /jobs, GET /jobs, GET /jobs/:id/stream) ----
//
// AUTHORITATIVE SOURCE: src/server/services/jobs.ts and
// src/server/routes/jobs.ts. A job runs server-side independently of any SSE
// connection; several can run at once (extra ones queue), and attaching to a
// job's stream replays its full event history before live events.

export type JobState = "queued" | "running" | "done" | "error";

/** Emitted on a job stream whenever the job changes lifecycle state. */
export interface JobStateEvent {
  type: "job:state";
  state: JobState;
}

/** Lightweight job descriptor returned by POST /jobs, GET /jobs(/:id). */
export interface JobSnapshot {
  id: string;
  state: JobState;
  /** Human-readable label derived from the run's pairs. */
  label: string;
  createdAt: string;
  totalCells: number;
  completedCells: number;
  summary: CompareUrlsSummary | null;
  /** The persisted run id, once the job is done. */
  runId?: string;
  error?: string;
}
