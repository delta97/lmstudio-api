import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  attachJobStream,
  getJobSnapshot,
  getRun,
  startJob as apiStartJob,
} from "@/lib/api";
import {
  EMPTY_SUMMARY,
  RunStoreContext,
  type LiveCell,
  type LiveJob,
  type RunStoreValue,
} from "@/lib/store";
import { cellKey } from "@/lib/types";
import type {
  CompareUrlsRequest,
  JobSnapshot,
  StoredRun,
} from "@/lib/types";

/** Snapshot-poll cadence when the SSE stream is unavailable. */
const POLL_INTERVAL_MS = 2500;

/** Records the elapsed time of the stage a cell is currently in, if any. */
function closeStage(cell: LiveCell, now: number): LiveCell {
  if (cell.phase.kind !== "stage" || cell.stageStartedAt === undefined) {
    return cell;
  }
  return {
    ...cell,
    stageDurations: {
      ...cell.stageDurations,
      [cell.phase.stage]: now - cell.stageStartedAt,
    },
  };
}

/**
 * Provides the cross-screen run store (see @/lib/store): a reactive map of
 * comparison jobs, each fed by its own SSE subscription to the backend's job
 * stream (with automatic snapshot-polling fallback when SSE drops). Lives
 * above the router so tracked jobs keep streaming across navigation.
 */
export function RunStoreProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Map<string, LiveJob>>(new Map());
  const [lastRun, setLastRun] = useState<StoredRun | null>(null);
  // One open stream or poll timer per job id; lives outside React state.
  const connections = useRef(new Map<string, { close: () => void }>());

  const disconnect = useCallback((id: string) => {
    connections.current.get(id)?.close();
    connections.current.delete(id);
  }, []);

  const updateJob = useCallback(
    (id: string, recipe: (job: LiveJob) => LiveJob) => {
      setJobs((prev) => {
        const job = prev.get(id);
        if (!job) return prev;
        const next = new Map(prev);
        next.set(id, recipe(job));
        return next;
      });
    },
    [],
  );

  const patchCell = useCallback(
    (
      id: string,
      key: string,
      recipe: (cell: LiveCell) => LiveCell,
      jobPatch?: (job: LiveJob) => Partial<LiveJob>,
    ) => {
      updateJob(id, (job) => {
        const cell = job.cells.get(key);
        if (!cell) return job;
        const cells = new Map(job.cells);
        cells.set(key, recipe(cell));
        return { ...job, cells, ...(jobPatch ? jobPatch(job) : {}) };
      });
    },
    [updateJob],
  );

  const finishJob = useCallback(
    (id: string, run: StoredRun) => {
      disconnect(id);
      setLastRun(run);
      updateJob(id, (job) => ({
        ...job,
        state: "done",
        phase: null,
        run,
        summary: run.summary,
        completedCells: run.summary.comparisons,
        finishedAt: Date.now(),
      }));
      toast.success("Comparison complete", {
        description: `${run.summary.comparisons} comparisons · ${run.summary.different} different`,
      });
    },
    [disconnect, updateJob],
  );

  const failJob = useCallback(
    (id: string, message: string) => {
      disconnect(id);
      updateJob(id, (job) => ({
        ...job,
        state: "error",
        phase: null,
        error: message,
        finishedAt: Date.now(),
      }));
      toast.error("Comparison failed", { description: message });
    },
    [disconnect, updateJob],
  );

  /**
   * Coarse fallback: poll the job snapshot until it reaches a terminal state,
   * then fetch the persisted run. No per-cell detail, but progress keeps
   * moving and the job still completes in the UI.
   */
  const startPolling = useCallback(
    (id: string) => {
      disconnect(id);
      updateJob(id, (job) => ({ ...job, degraded: true }));
      let busy = false;
      const timer = window.setInterval(() => {
        if (busy) return;
        busy = true;
        void (async () => {
          try {
            const snap = await getJobSnapshot(id);
            updateJob(id, (job) => ({
              ...job,
              state: snap.state,
              totalCells: snap.totalCells || job.totalCells,
              completedCells: snap.completedCells,
              summary: snap.summary ?? job.summary,
            }));
            if (snap.state === "done" && snap.runId) {
              window.clearInterval(timer);
              finishJob(id, await getRun(snap.runId));
            } else if (snap.state === "error") {
              window.clearInterval(timer);
              failJob(id, snap.error ?? "Run failed");
            }
          } catch {
            // Backend unreachable; keep polling — the job may still finish.
          } finally {
            busy = false;
          }
        })();
      }, POLL_INTERVAL_MS);
      connections.current.set(id, {
        close: () => window.clearInterval(timer),
      });
    },
    [disconnect, updateJob, finishJob, failJob],
  );

  /** Opens the job's SSE stream (server replays history on attach). */
  const connect = useCallback(
    (id: string) => {
      disconnect(id);
      const handle = attachJobStream(id, {
        onJobState: (e) => {
          updateJob(id, (job) => ({ ...job, state: e.state }));
        },
        onRunStart: (e) => {
          const now = Date.now();
          updateJob(id, (job) => {
            const cells = new Map<string, LiveCell>();
            const order: string[] = [];
            for (const pair of e.pairs) {
              for (const bp of e.breakpoints) {
                const key = cellKey(pair.name, bp.name);
                order.push(key);
                cells.set(key, {
                  name: pair.name,
                  breakpoint: bp.name,
                  width: bp.width,
                  height: bp.height,
                  phase: { kind: "queued" },
                  stageDurations: {},
                });
              }
            }
            return {
              ...job,
              totalCells: e.totalCells,
              completedCells: 0,
              cells,
              order,
              degraded: false,
              startedAt: now,
            };
          });
        },
        onRunPhase: (e) => {
          updateJob(id, (job) => ({ ...job, phase: e.phase }));
        },
        onCellStart: (e) => {
          patchCell(id, cellKey(e.name, e.breakpoint), (cell) => ({
            ...cell,
            width: e.width,
            height: e.height,
            phase: { kind: "stage", stage: "capturing-baseline" },
            stageDurations: {},
            stageStartedAt: Date.now(),
          }));
        },
        onCellStage: (e) => {
          const now = Date.now();
          patchCell(id, cellKey(e.name, e.breakpoint), (cell) => ({
            ...closeStage(cell, now),
            phase: { kind: "stage", stage: e.stage },
            stageStartedAt: now,
          }));
        },
        onCellDone: (e) => {
          const now = Date.now();
          patchCell(
            id,
            cellKey(e.item.name, e.item.breakpoint),
            (cell) => ({
              ...closeStage(cell, now),
              phase: { kind: "done", verdict: e.item.verdict },
              stageStartedAt: undefined,
              diffRatio: e.item.diffRatio,
              confidence: e.item.ai?.confidence,
              aiSummary: e.item.ai?.summary,
              usage: e.item.ai?.usage,
              thumbnails: e.thumbnails,
            }),
            (job) => ({ completedCells: job.completedCells + 1 }),
          );
        },
        onCellError: (e) => {
          const now = Date.now();
          patchCell(
            id,
            cellKey(e.name, e.breakpoint),
            (cell) => ({
              ...closeStage(cell, now),
              phase: { kind: "error" },
              stageStartedAt: undefined,
              error: e.error,
            }),
            (job) => ({ completedCells: job.completedCells + 1 }),
          );
        },
        onSummaryUpdate: (e) => {
          updateJob(id, (job) => ({
            ...job,
            summary: {
              comparisons: e.comparisons,
              different: e.different,
              errors: e.errors,
              changesFlagged: e.changesFlagged,
              aiCalls: e.aiCalls,
              totalTokens: e.totalTokens,
              costUsd: e.costUsd,
            },
          }));
        },
        onDone: (run) => finishJob(id, run),
        onError: (err) => {
          // An Error carries the server's terminal "error" payload; a bare
          // Event is a transport failure. Reconnecting the EventSource would
          // re-trigger the full replay, so switch to snapshot polling instead.
          if (err instanceof Error) {
            failJob(id, err.message);
          } else {
            startPolling(id);
          }
        },
      });
      connections.current.set(id, handle);
    },
    [disconnect, updateJob, patchCell, finishJob, failJob, startPolling],
  );

  const adoptJob = useCallback(
    (snapshot: JobSnapshot) => {
      let added = false;
      setJobs((prev) => {
        if (prev.has(snapshot.id)) return prev;
        added = true;
        const createdMs = Date.parse(snapshot.createdAt);
        const job: LiveJob = {
          id: snapshot.id,
          label: snapshot.label,
          createdAt: snapshot.createdAt,
          state: snapshot.state,
          phase: null,
          totalCells: snapshot.totalCells,
          completedCells: snapshot.completedCells,
          degraded: false,
          order: [],
          cells: new Map(),
          summary: snapshot.summary ?? EMPTY_SUMMARY,
          run: null,
          error: snapshot.error ?? null,
          startedAt: Number.isNaN(createdMs) ? Date.now() : createdMs,
          finishedAt: null,
        };
        const next = new Map(prev);
        next.set(snapshot.id, job);
        return next;
      });
      if (added) connect(snapshot.id);
    },
    [connect],
  );

  const startJob = useCallback(
    async (config: CompareUrlsRequest) => {
      const snapshot = await apiStartJob(config);
      adoptJob(snapshot);
      return snapshot;
    },
    [adoptJob],
  );

  const dismissJob = useCallback(
    (id: string) => {
      disconnect(id);
      setJobs((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [disconnect],
  );

  // Tear down every open stream/poller when the provider unmounts.
  useEffect(() => {
    const open = connections.current;
    return () => {
      for (const handle of open.values()) handle.close();
      open.clear();
    };
  }, []);

  const jobList = useMemo(
    () =>
      [...jobs.values()].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      ),
    [jobs],
  );

  const value = useMemo<RunStoreValue>(
    () => ({
      jobs: jobList,
      startJob,
      adoptJob,
      dismissJob,
      lastRun,
      setLastRun,
    }),
    [jobList, startJob, adoptJob, dismissJob, lastRun],
  );

  return (
    <RunStoreContext.Provider value={value}>
      {children}
    </RunStoreContext.Provider>
  );
}
