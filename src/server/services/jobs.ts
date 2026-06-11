import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { CompareUrlsRequest, CompareUrlsSummary } from "../types.js";
import type { CompareEvent } from "./events.js";
import { compareUrls } from "./urlCompare.js";
import { persistRun, type StoredRun } from "./runStore.js";

/**
 * In-memory comparison-job manager so the UI can run several comparisons at
 * once and (re)attach to any of them.
 *
 * A job buffers every progress event it emits; a subscriber that attaches
 * mid-run (or after a page reload) first receives the full replay, then live
 * events, so its view is always complete. At most
 * `config.jobs.maxConcurrent` jobs execute simultaneously — each one owns a
 * Playwright browser — and the rest wait in a FIFO queue in the "queued"
 * state.
 */

export type JobState = "queued" | "running" | "done" | "error";

/**
 * One SSE-ready message: `event` is the SSE event name, `data` the JSON
 * payload. Progress events reuse the CompareEvent protocol of
 * GET /compare-urls/stream; jobs add "job:state" plus the terminal
 * "done" (StoredRun) and "error" ({ error, message }) events.
 */
export interface JobMessage {
  event: string;
  data: unknown;
}

export type JobSubscriber = (message: JobMessage) => void;

/** Lightweight job descriptor for listings and polling. */
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

interface Job {
  id: string;
  config: CompareUrlsRequest;
  state: JobState;
  label: string;
  createdAt: string;
  totalCells: number;
  completedCells: number;
  summary: CompareUrlsSummary | null;
  run: StoredRun | null;
  error: string | null;
  /** Every message emitted so far, replayed to late subscribers. */
  buffer: JobMessage[];
  subscribers: Set<JobSubscriber>;
}

/** Finished jobs kept around for late attach/polling before being pruned. */
const MAX_FINISHED_JOBS = 20;

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let runningCount = 0;

function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function labelFor(request: CompareUrlsRequest): string {
  const pairs = request.pairs?.length
    ? request.pairs.map((p) => p.name ?? hostLabel(p.currentUrl))
    : [hostLabel(request.currentUrl ?? "comparison")];
  const head = pairs.slice(0, 2).join(", ");
  return pairs.length > 2 ? `${head} +${pairs.length - 2}` : head;
}

export function snapshotJob(job: Job): JobSnapshot {
  return {
    id: job.id,
    state: job.state,
    label: job.label,
    createdAt: job.createdAt,
    totalCells: job.totalCells,
    completedCells: job.completedCells,
    summary: job.summary,
    ...(job.run ? { runId: job.run.id } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function push(job: Job, message: JobMessage): void {
  job.buffer.push(message);
  for (const subscriber of job.subscribers) subscriber(message);
}

function setState(job: Job, state: JobState): void {
  job.state = state;
  push(job, { event: "job:state", data: { type: "job:state", state } });
}

function trackProgress(job: Job, event: CompareEvent): void {
  if (event.type === "run:start") job.totalCells = event.totalCells;
  if (event.type === "cell:done" || event.type === "cell:error") {
    job.completedCells++;
  }
  if (event.type === "summary:update") {
    const { type: _type, ...summary } = event;
    job.summary = summary;
  }
}

async function execute(job: Job): Promise<void> {
  try {
    const raw = await compareUrls(job.config, (event) => {
      trackProgress(job, event);
      push(job, { event: event.type, data: event });
    });
    // Writing images + HTML/MD happens after the last cell; surface it so
    // attached UIs aren't frozen at 100% while the report is generated.
    push(job, {
      event: "run:phase",
      data: { type: "run:phase", phase: "generating-report" },
    });
    const { spaResponse } = await persistRun(raw);
    job.run = spaResponse;
    job.state = "done";
    push(job, { event: "done", data: spaResponse });
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.state = "error";
    push(job, {
      event: "error",
      data: { error: "URL comparison failed", message: job.error },
    });
  }
}

function pump(): void {
  while (runningCount < config.jobs.maxConcurrent && queue.length > 0) {
    const job = queue.shift() as Job;
    runningCount++;
    setState(job, "running");
    void execute(job).finally(() => {
      runningCount--;
      pruneFinished();
      pump();
    });
  }
}

/** Drops the oldest finished jobs beyond the retention cap. */
function pruneFinished(): void {
  const finished = [...jobs.values()].filter(
    (j) => j.state === "done" || j.state === "error",
  );
  // Insertion order is creation order, so the front of the list is oldest.
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) {
    jobs.delete(job.id);
  }
}

/** Registers a new comparison job and starts it as soon as a slot frees up. */
export function startJob(request: CompareUrlsRequest): JobSnapshot {
  const job: Job = {
    id: randomUUID(),
    config: request,
    state: "queued",
    label: labelFor(request),
    createdAt: new Date().toISOString(),
    totalCells: 0,
    completedCells: 0,
    summary: null,
    run: null,
    error: null,
    buffer: [],
    subscribers: new Set(),
  };
  jobs.set(job.id, job);
  push(job, { event: "job:state", data: { type: "job:state", state: "queued" } });
  queue.push(job);
  pump();
  return snapshotJob(job);
}

export function getJob(id: string): JobSnapshot | null {
  const job = jobs.get(id);
  return job ? snapshotJob(job) : null;
}

/** All known jobs, newest first. */
export function listJobs(): JobSnapshot[] {
  return [...jobs.values()].map(snapshotJob).reverse();
}

/**
 * Subscribes to a job's event stream. The buffered history is replayed
 * synchronously before live events; returns an unsubscribe function, or null
 * if the job does not exist.
 */
export function subscribeToJob(
  id: string,
  subscriber: JobSubscriber,
): (() => void) | null {
  const job = jobs.get(id);
  if (!job) return null;
  for (const message of job.buffer) subscriber(message);
  job.subscribers.add(subscriber);
  return () => job.subscribers.delete(subscriber);
}
