/**
 * Cross-screen run store, provided above the router <Outlet> (see
 * RunStoreProvider) so values survive client-side navigation.
 *
 * The store tracks comparison JOBS: Setup starts one via {@link RunStoreValue.startJob}
 * and any number can run at once. Each tracked job owns an SSE subscription to
 * the backend (which replays history on attach), and the Live Run screen
 * renders every tracked job reactively. Direct deep-links (e.g. opening
 * /results/:id) don't rely on the store — those screens fetch from the API.
 */

import { createContext, useContext } from "react";
import type { CellPhase } from "@/lib/status";
import type {
  CellStage,
  CellThumbnails,
  CompareUrlsRequest,
  CompareUrlsSummary,
  JobSnapshot,
  JobState,
  LlmUsage,
  RunPhase,
  StoredRun,
} from "@/lib/types";

/** Live view of one (pair x breakpoint) cell within a tracked job. */
export interface LiveCell {
  name: string;
  breakpoint: string;
  width: number;
  height: number;
  phase: CellPhase;
  /** Wall-clock duration of each completed stage, in ms. */
  stageDurations: Partial<Record<CellStage, number>>;
  /** Epoch ms when the current stage started (while phase.kind === "stage"). */
  stageStartedAt?: number;
  diffRatio?: number;
  confidence?: number;
  aiSummary?: string;
  /** Token/cost accounting for this cell's AI call, when one ran. */
  usage?: LlmUsage;
  thumbnails?: CellThumbnails;
  error?: string;
}

/** Live view of one tracked comparison job. */
export interface LiveJob {
  id: string;
  label: string;
  createdAt: string;
  state: JobState;
  phase: RunPhase | null;
  totalCells: number;
  /** Cells finished so far (done or errored). */
  completedCells: number;
  /**
   * True when the live SSE stream dropped and the store fell back to polling
   * job snapshots — coarse progress only, no per-cell stage updates.
   */
  degraded: boolean;
  /** Cell keys in run order (see cellKey). */
  order: string[];
  cells: Map<string, LiveCell>;
  summary: CompareUrlsSummary;
  /** The persisted run, once the job finished successfully. */
  run: StoredRun | null;
  error: string | null;
  /** Epoch ms when this client started tracking the job. */
  startedAt: number;
  finishedAt: number | null;
}

export const EMPTY_SUMMARY: CompareUrlsSummary = {
  comparisons: 0,
  different: 0,
  errors: 0,
  changesFlagged: 0,
  aiCalls: 0,
  totalTokens: 0,
  costUsd: 0,
};

export interface RunStoreValue {
  /** Tracked jobs, newest first. */
  jobs: LiveJob[];
  /** Starts a job on the server and begins tracking its stream. */
  startJob: (config: CompareUrlsRequest) => Promise<JobSnapshot>;
  /** Starts tracking an already-running server job (e.g. after a reload). */
  adoptJob: (snapshot: JobSnapshot) => void;
  /** Stops tracking a job (does NOT cancel it server-side). */
  dismissJob: (id: string) => void;
  /** The most recently finished run, handed from Live Run to Results. */
  lastRun: StoredRun | null;
  setLastRun: (run: StoredRun | null) => void;
}

export const RunStoreContext = createContext<RunStoreValue | null>(null);

export function useRunStore(): RunStoreValue {
  const ctx = useContext(RunStoreContext);
  if (!ctx) {
    throw new Error("useRunStore must be used within a RunStoreProvider");
  }
  return ctx;
}
