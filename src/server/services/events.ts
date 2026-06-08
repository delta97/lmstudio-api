import type { UrlComparisonItem } from "../types.js";

/**
 * Stages a single pair x breakpoint cell moves through, derived from the
 * capture -> pixel-diff -> (conditional) AI-triage flow in urlCompare().
 */
export type CellStage =
  | "capturing-baseline"
  | "capturing-current"
  | "pixel-diffing"
  | "ai-reviewing";

/** Identity of a single comparison pair. */
export interface EventPair {
  name: string;
  baselineUrl: string;
  currentUrl: string;
}

/**
 * Run-level phases that bracket the per-cell work, so the UI can show what the
 * run is doing during the gaps the cell stages don't cover: launching the
 * browser before any capture, and generating the report after the last cell.
 */
export type RunPhase = "launching" | "capturing" | "generating-report";

/** Emitted when the run as a whole moves into a new phase. */
export interface RunPhaseEvent {
  type: "run:phase";
  phase: RunPhase;
}

/** A breakpoint as advertised at the start of a run. */
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
 * Small, directly-embeddable (data URL) JPEG previews so the UI can show
 * thumbnails live before the full-resolution report is written to disk.
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
}

/** Discriminated union of every event emitted while a run is in progress. */
export type CompareEvent =
  | RunStartEvent
  | RunPhaseEvent
  | CellStartEvent
  | CellStageEvent
  | CellDoneEvent
  | CellErrorEvent
  | SummaryUpdateEvent;

/** Callback invoked for each progress event. */
export type CompareEventHandler = (event: CompareEvent) => void;
