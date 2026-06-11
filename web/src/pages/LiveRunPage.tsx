import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleDashedIcon,
  MinusIcon,
  SlidersHorizontalIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  RUN_PHASE_META,
  STAGE_META,
  STAGE_SEQUENCE,
  VERDICT_META,
} from "@/lib/status";
import { listJobs } from "@/lib/api";
import { useRunStore, type LiveCell, type LiveJob } from "@/lib/store";
import {
  formatConfidence,
  formatCost,
  formatDuration,
  formatElapsed,
  formatRatio,
  formatTokens,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export default function LiveRunPage() {
  const { jobs, adoptJob } = useRunStore();

  // Re-adopt jobs that are still running server-side (e.g. after a reload);
  // the job stream replays history, so their grids rebuild completely.
  useEffect(() => {
    listJobs()
      .then((snapshots) => {
        for (const snapshot of snapshots) {
          if (snapshot.state === "queued" || snapshot.state === "running") {
            adoptJob(snapshot);
          }
        }
      })
      .catch(() => {
        // Backend unreachable; tracked jobs (if any) still render.
      });
  }, [adoptJob]);

  // One shared ticker drives every elapsed-time and active-stage readout.
  const [now, setNow] = useState(() => Date.now());
  const anyActive = jobs.some(
    (j) => j.state === "queued" || j.state === "running",
  );
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyActive]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Live runs</h1>
          <p className="text-sm text-muted-foreground">
            Every comparison job, streamed step by step. Each cell is one pair
            at one breakpoint moving through capture, pixel diff, and AI
            review. Start more runs at any time — they execute in parallel.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          render={<Link to="/" />}
        >
          <SlidersHorizontalIcon data-icon="inline-start" />
          New comparison
        </Button>
      </header>

      {jobs.length === 0 ? (
        <>
          <Alert>
            <SlidersHorizontalIcon />
            <AlertTitle>No active runs</AlertTitle>
            <AlertDescription>
              Start a comparison from the setup screen to watch it run live.
              Multiple comparisons can run at the same time.
            </AlertDescription>
          </Alert>
          <Button className="w-fit" render={<Link to="/" />}>
            Go to setup
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-8">
          {jobs.map((job) => (
            <JobPanel key={job.id} job={job} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobPanel({ job, now }: { job: LiveJob; now: number }) {
  const navigate = useNavigate();
  const { dismissJob } = useRunStore();
  const { summary } = job;

  const terminal = job.state === "done" || job.state === "error";
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const progressValue =
    job.totalCells > 0 ? (job.completedCells / job.totalCells) * 100 : null;
  const showIndeterminate =
    !terminal && (job.totalCells === 0 || (job.degraded && job.totalCells === 0));

  return (
    <section className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <JobStateBadge job={job} />
              <span
                className="max-w-56 truncate font-mono text-sm sm:max-w-xs"
                title={job.label}
              >
                {job.label}
              </span>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatElapsed(elapsed)}
              </span>
              {job.degraded && !terminal ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <WifiOffIcon className="size-3" />
                  polling
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
              <Stat
                label="match"
                value={summary.comparisons - summary.different - summary.errors}
                tone="text-emerald-400"
              />
              <Stat label="different" value={summary.different} tone="text-amber-400" />
              <Stat label="errors" value={summary.errors} tone="text-destructive" />
              <Stat label="changes" value={summary.changesFlagged} tone="text-foreground" />
              {(summary.totalTokens ?? 0) > 0 ? (
                <span className="flex items-center gap-1">
                  <span className="tabular-nums text-foreground">
                    {formatTokens(summary.totalTokens ?? 0)}
                  </span>
                  <span className="text-muted-foreground">tokens</span>
                </span>
              ) : null}
              {(summary.aiCalls ?? 0) > 0 ? (
                <span className="flex items-center gap-1">
                  <span className="tabular-nums text-foreground">
                    {formatCost(summary.costUsd ?? 0)}
                  </span>
                  <span className="text-muted-foreground">ai cost</span>
                </span>
              ) : null}
            </div>
          </div>

          {job.error ? (
            <Alert variant="destructive">
              <XIcon />
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription>{job.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Progress value={showIndeterminate ? null : progressValue} />
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
              <span>
                {job.completedCells} / {job.totalCells || "?"} cells
              </span>
              <div className="flex items-center gap-2">
                {job.run ? (
                  <Button
                    size="sm"
                    onClick={() => navigate(`/results/${job.run!.id}`)}
                  >
                    View results
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                ) : null}
                {terminal ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissJob(job.id)}
                  >
                    <XIcon data-icon="inline-start" />
                    Dismiss
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {job.order.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {job.order.map((key) => {
            const cell = job.cells.get(key);
            if (!cell) return null;
            return <CellCard key={key} cell={cell} now={now} />;
          })}
        </div>
      ) : !terminal ? (
        <p className="px-1 font-mono text-xs text-muted-foreground">
          {job.state === "queued"
            ? "Waiting for a free run slot…"
            : job.degraded
              ? "Live stream unavailable — progress is polled without per-cell detail."
              : "Waiting for the run plan…"}
        </p>
      ) : null}
    </section>
  );
}

function JobStateBadge({ job }: { job: LiveJob }) {
  if (job.state === "done") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      >
        complete
      </Badge>
    );
  }
  if (job.state === "error") {
    return (
      <Badge
        variant="outline"
        className="border-destructive/30 bg-destructive/10 text-destructive"
      >
        failed
      </Badge>
    );
  }
  if (job.state === "queued") {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <CircleDashedIcon className="size-3" />
        queued
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1.5">
      <Spinner className="size-3" />
      {job.phase ? RUN_PHASE_META[job.phase].label : "running"}
    </Badge>
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

function CellCard({ cell, now }: { cell: LiveCell; now: number }) {
  const { phase } = cell;

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

        <VerdictRow cell={cell} />
        <StageStepper cell={cell} now={now} />

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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
            <span>diff {formatRatio(cell.diffRatio)}</span>
            {typeof cell.confidence === "number" ? (
              <span>conf {formatConfidence(cell.confidence)}</span>
            ) : null}
            {cell.usage ? (
              <span>{formatTokens(cell.usage.totalTokens)} tok</span>
            ) : null}
            {typeof cell.usage?.costUsd === "number" ? (
              <span>{formatCost(cell.usage.costUsd)}</span>
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

/** The cell's headline state: queued, current stage, or final verdict. */
function VerdictRow({ cell }: { cell: LiveCell }) {
  const { phase } = cell;
  if (phase.kind === "queued") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleDashedIcon className="size-4" />
        Queued
      </div>
    );
  }
  if (phase.kind === "stage") {
    const meta = STAGE_META[phase.stage];
    return (
      <div className="flex items-center gap-2 text-sm">
        <Spinner className="size-4 text-primary" />
        <span>{meta.label}</span>
        <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground">
          {STAGE_SEQUENCE.indexOf(phase.stage) + 1}/{STAGE_SEQUENCE.length}
        </span>
      </div>
    );
  }
  const meta =
    phase.kind === "done" ? VERDICT_META[phase.verdict] : VERDICT_META.error;
  const Icon = meta.Icon;
  return (
    <div className={cn("flex items-center gap-2 text-sm", meta.text)}>
      <Icon className="size-4" />
      {phase.kind === "error" && cell.error ? "Capture error" : meta.label}
    </div>
  );
}

type StageStatus = "done" | "active" | "pending" | "skipped";

/**
 * The granular per-cell progress readout: one row per pipeline stage with its
 * live or final duration. Stages that never ran on a finished cell (e.g. AI
 * review when the pixel diff already decided) render as skipped.
 */
function StageStepper({ cell, now }: { cell: LiveCell; now: number }) {
  const { phase } = cell;
  const activeIndex =
    phase.kind === "stage" ? STAGE_SEQUENCE.indexOf(phase.stage) : -1;
  const terminal = phase.kind === "done" || phase.kind === "error";

  return (
    <ol className="flex flex-col gap-1 rounded-md bg-muted/30 p-2">
      {STAGE_SEQUENCE.map((stage, i) => {
        const meta = STAGE_META[stage];
        const duration = cell.stageDurations[stage];
        const status: StageStatus =
          phase.kind === "queued"
            ? "pending"
            : phase.kind === "stage"
              ? i < activeIndex
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending"
              : duration !== undefined
                ? "done"
                : "skipped";

        const liveMs =
          status === "active" && cell.stageStartedAt !== undefined
            ? Math.max(0, now - cell.stageStartedAt)
            : null;

        return (
          <li
            key={stage}
            className={cn(
              "flex items-center gap-2 text-xs",
              status === "active"
                ? "text-foreground"
                : status === "done"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60",
            )}
          >
            {status === "done" ? (
              <CheckIcon className="size-3.5 shrink-0 text-emerald-400" />
            ) : status === "active" ? (
              <Spinner className="size-3.5 shrink-0 text-primary" />
            ) : status === "skipped" ? (
              <MinusIcon className="size-3.5 shrink-0" />
            ) : (
              <CircleDashedIcon className="size-3.5 shrink-0" />
            )}
            <meta.Icon className="size-3.5 shrink-0" />
            <span className="truncate">{meta.label}</span>
            <span className="ml-auto font-mono text-[0.7rem] tabular-nums">
              {status === "skipped"
                ? terminal
                  ? "skipped"
                  : ""
                : duration !== undefined
                  ? formatDuration(duration)
                  : liveMs !== null
                    ? formatDuration(liveMs)
                    : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
