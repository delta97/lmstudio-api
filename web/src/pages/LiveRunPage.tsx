import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRightIcon, RadioIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  RUN_PHASE_META,
  STAGE_META,
  STAGE_SEQUENCE,
  VERDICT_META,
  StageIcons,
  type CellPhase,
} from "@/lib/status";
import { listRuns, getRun, runCompareBlocking, startRunStream } from "@/lib/api";
import { useRunStore } from "@/lib/store";
import { cellKey } from "@/lib/types";
import type {
  CompareUrlsRequest,
  CompareUrlsSummary,
  RunPhase,
  StoredRun,
} from "@/lib/types";
import { formatConfidence, formatElapsed, formatRatio } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LiveCell {
  name: string;
  breakpoint: string;
  width: number;
  height: number;
  phase: CellPhase;
  diffRatio?: number;
  confidence?: number;
  aiSummary?: string;
  thumbnails?: { baseline: string; current: string; diff: string };
  error?: string;
}

const EMPTY_SUMMARY: CompareUrlsSummary = {
  comparisons: 0,
  different: 0,
  errors: 0,
  changesFlagged: 0,
};

export default function LiveRunPage() {
  const navigate = useNavigate();
  const { pendingConfig, setLastRun } = useRunStore();
  // Snapshot the config once so store changes don't restart the stream.
  const [config] = useState<CompareUrlsRequest | null>(() => pendingConfig);

  const [cells, setCells] = useState<Map<string, LiveCell>>(new Map());
  const [order, setOrder] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<RunPhase | null>(null);
  const [summary, setSummary] = useState<CompareUrlsSummary>(EMPTY_SUMMARY);
  // Seeded once at mount; the run starts streaming immediately after.
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [finishedRun, setFinishedRun] = useState<StoredRun | null>(null);
  const [fallback, setFallback] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const settled = useRef(false);
  const sawEvent = useRef(false);
  const fallbackStarted = useRef(false);
  const streamRef = useRef<{ close: () => void } | null>(null);

  const patchCell = useCallback(
    (key: string, patch: Partial<LiveCell>) => {
      setCells((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        if (!existing) return prev;
        next.set(key, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  const finish = useCallback(
    (run: StoredRun) => {
      if (settled.current) return;
      settled.current = true;
      setFinishedRun(run);
      setLastRun(run);
      toast.success("Comparison complete", {
        description: `${run.summary.comparisons} comparisons · ${run.summary.different} different`,
      });
      // Brief pause so the final state is visible, then advance to Results.
      setTimeout(() => navigate(`/results/${run.id}`), 900);
    },
    [navigate, setLastRun],
  );

  const runFallback = useCallback(
    async (cfg: CompareUrlsRequest) => {
      if (fallbackStarted.current) return;
      fallbackStarted.current = true;
      // Stop the EventSource from retrying behind the blocking fallback.
      streamRef.current?.close();
      setFallback(true);
      try {
        await runCompareBlocking(cfg);
        // The blocking endpoint persists a run but returns report-relative
        // image URLs without an id; fetch the freshly-written run to get
        // root-relative URLs + id for the Results screen.
        const runs = await listRuns();
        const newest = runs[0];
        if (newest) {
          const full = await getRun(newest.id);
          finish(full);
          return;
        }
        throw new Error("Run finished but could not be located.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFatalError(message);
        toast.error("Comparison failed", { description: message });
      }
    },
    [finish],
  );

  // Open the SSE stream on mount.
  useEffect(() => {
    if (!config) return;

    const handle = startRunStream(config, {
      onRunStart: (e) => {
        sawEvent.current = true;
        setTotal(e.totalCells);
        const map = new Map<string, LiveCell>();
        const keys: string[] = [];
        for (const pair of e.pairs) {
          for (const bp of e.breakpoints) {
            const key = cellKey(pair.name, bp.name);
            keys.push(key);
            map.set(key, {
              name: pair.name,
              breakpoint: bp.name,
              width: bp.width,
              height: bp.height,
              phase: { kind: "queued" },
            });
          }
        }
        setCells(map);
        setOrder(keys);
      },
      onRunPhase: (e) => {
        sawEvent.current = true;
        setPhase(e.phase);
      },
      onCellStart: (e) => {
        sawEvent.current = true;
        patchCell(cellKey(e.name, e.breakpoint), {
          width: e.width,
          height: e.height,
          phase: { kind: "stage", stage: "capturing-baseline" },
        });
      },
      onCellStage: (e) => {
        patchCell(cellKey(e.name, e.breakpoint), {
          phase: { kind: "stage", stage: e.stage },
        });
      },
      onCellDone: (e) => {
        patchCell(cellKey(e.item.name, e.item.breakpoint), {
          phase: { kind: "done", verdict: e.item.verdict },
          diffRatio: e.item.diffRatio,
          confidence: e.item.ai?.confidence,
          aiSummary: e.item.ai?.summary,
          thumbnails: e.thumbnails,
        });
      },
      onCellError: (e) => {
        patchCell(cellKey(e.name, e.breakpoint), {
          phase: { kind: "error" },
          error: e.error,
        });
      },
      onSummaryUpdate: (e) => {
        setSummary({
          comparisons: e.comparisons,
          different: e.different,
          errors: e.errors,
          changesFlagged: e.changesFlagged,
        });
      },
      onDone: (run) => finish(run),
      onError: (err) => {
        if (settled.current) return;
        // If the stream errored before producing any event, fall back to the
        // blocking endpoint. Otherwise surface the error.
        if (!sawEvent.current) {
          void runFallback(config);
        } else {
          const message =
            err instanceof Error ? err.message : "Connection lost";
          setFatalError(message);
          toast.error("Run stream error", { description: message });
        }
      },
    });

    streamRef.current = handle;
    return () => handle.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Elapsed timer.
  useEffect(() => {
    if (finishedRun) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt, finishedRun]);

  const completed = useMemo(
    () =>
      order.filter((k) => {
        const c = cells.get(k);
        return c && (c.phase.kind === "done" || c.phase.kind === "error");
      }).length,
    [order, cells],
  );

  const progressValue = total > 0 ? (completed / total) * 100 : 0;

  if (!config) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <Alert>
          <SlidersHorizontalIcon />
          <AlertTitle>No run configured</AlertTitle>
          <AlertDescription>
            Start a comparison from the setup screen to watch it run live.
          </AlertDescription>
        </Alert>
        <Button className="w-fit" render={<Link to="/" />}>
          Go to setup
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />

      {fatalError ? (
        <Alert variant="destructive">
          <RadioIcon />
          <AlertTitle>Run failed</AlertTitle>
          <AlertDescription>{fatalError}</AlertDescription>
        </Alert>
      ) : null}

      {/* Summary bar */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {finishedRun ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                >
                  complete
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1.5">
                  <Spinner className="size-3" />
                  {fallback
                    ? "running (no live stream)"
                    : phase
                      ? RUN_PHASE_META[phase].label
                      : "running"}
                </Badge>
              )}
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatElapsed(elapsed)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <Stat label="match" value={summary.comparisons - summary.different - summary.errors} tone="text-emerald-400" />
              <Stat label="different" value={summary.different} tone="text-amber-400" />
              <Stat label="errors" value={summary.errors} tone="text-destructive" />
              <Stat label="changes" value={summary.changesFlagged} tone="text-foreground" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Progress
              value={fallback && !finishedRun ? null : progressValue}
            />
            <div className="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
              <span>
                {completed} / {total || "?"} cells
              </span>
              {finishedRun ? (
                <Button
                  size="sm"
                  onClick={() => navigate(`/results/${finishedRun.id}`)}
                >
                  View results
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cell grid */}
      {fallback && order.length === 0 ? (
        <FallbackGrid />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {order.map((key) => {
            const cell = cells.get(key);
            if (!cell) return null;
            return <CellCard key={key} cell={cell} />;
          })}
        </div>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Live run</h1>
      <p className="text-sm text-muted-foreground">
        Each cell is one pair captured at one breakpoint, streamed as it
        progresses through capture, pixel diff, and AI review.
      </p>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("tabular-nums", tone)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function CellCard({ cell }: { cell: LiveCell }) {
  const { phase } = cell;
  const isActive = phase.kind === "stage";

  return (
    <Card
      size="sm"
      className={cn(
        "transition-colors",
        phase.kind === "done" && cn("ring-1", VERDICT_META[phase.verdict].ring),
        phase.kind === "error" && "ring-1 ring-destructive/30",
      )}
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate font-mono text-sm" title={cell.name}>
            {cell.name}
          </span>
          <Badge variant="secondary" className="shrink-0 font-mono text-[0.7rem]">
            {cell.breakpoint} · {cell.width}×{cell.height}
          </Badge>
        </div>

        <PhaseRow phase={phase} active={isActive} error={cell.error} />

        {cell.thumbnails ? (
          <div className="grid grid-cols-3 gap-1.5">
            {(["baseline", "current", "diff"] as const).map((k) => (
              <figure key={k} className="flex flex-col gap-1">
                <img
                  src={cell.thumbnails![k]}
                  alt={`${k} thumbnail`}
                  className="aspect-video w-full rounded border border-border object-cover object-top"
                />
                <figcaption className="text-center font-mono text-[0.6rem] text-muted-foreground">
                  {k}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        {typeof cell.diffRatio === "number" && phase.kind !== "queued" ? (
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            <span>diff {formatRatio(cell.diffRatio)}</span>
            {typeof cell.confidence === "number" ? (
              <span>conf {formatConfidence(cell.confidence)}</span>
            ) : null}
          </div>
        ) : null}

        {cell.aiSummary ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {cell.aiSummary}
          </p>
        ) : null}

        {cell.error ? (
          <p className="line-clamp-2 text-xs text-destructive">{cell.error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PhaseRow({
  phase,
  active,
  error,
}: {
  phase: CellPhase;
  active: boolean;
  error?: string;
}) {
  if (phase.kind === "queued") {
    const Icon = StageIcons.queued;
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" />
        Queued
      </div>
    );
  }
  if (phase.kind === "stage") {
    const meta = STAGE_META[phase.stage];
    const stepIndex = STAGE_SEQUENCE.indexOf(phase.stage) + 1;
    return (
      <div className="flex items-center gap-2 text-sm">
        {active ? (
          <Spinner className="size-4 text-primary" />
        ) : (
          <meta.Icon className="size-4 text-primary" />
        )}
        <span>{meta.label}</span>
        <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground">
          {stepIndex}/{STAGE_SEQUENCE.length}
        </span>
      </div>
    );
  }
  if (phase.kind === "done") {
    const meta = VERDICT_META[phase.verdict];
    const Icon = meta.Icon;
    return (
      <div className={cn("flex items-center gap-2 text-sm", meta.text)}>
        <Icon className="size-4" />
        {meta.label}
      </div>
    );
  }
  // error
  const meta = VERDICT_META.error;
  const Icon = meta.Icon;
  return (
    <div className={cn("flex items-center gap-2 text-sm", meta.text)}>
      <Icon className="size-4" />
      {error ? "Capture error" : meta.label}
    </div>
  );
}

function FallbackGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} size="sm">
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="aspect-video w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
