import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LayersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DecidedByBadge,
  SeverityBadge,
  VerdictBadge,
} from "@/components/status";
import { sortChangesBySeverity, type Severity } from "@/lib/status";
import { DiffViewer } from "@/components/DiffViewer";
import { getRun } from "@/lib/api";
import { useRunStore } from "@/lib/store";
import {
  formatConfidence,
  formatCost,
  formatRatio,
  formatTimestamp,
  formatTokens,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StoredRun, UrlComparisonItem } from "@/lib/types";

type VerdictFilter = "all" | "pass" | "fail" | "error";
type SeverityFilter = "all" | Severity;

export default function ResultsPage() {
  const { runId } = useParams();
  const { lastRun } = useRunStore();

  // When a :runId is present we fetch it; otherwise we derive the run straight
  // from the store (the just-finished run). Results are tagged with their id so
  // loading/error can be derived (no synchronous setState in the effect).
  const [fetched, setFetched] = useState<{ id: string; run: StoredRun } | null>(
    null,
  );
  const [fetchError, setFetchError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    getRun(runId)
      .then((r) => {
        if (active) setFetched({ id: runId, run: r });
      })
      .catch((err: unknown) => {
        if (active)
          setFetchError({
            id: runId,
            message: err instanceof Error ? err.message : "Failed to load run",
          });
      });
    return () => {
      active = false;
    };
  }, [runId]);

  const fetchedRun =
    fetched && fetched.id === runId ? fetched.run : null;
  const error =
    fetchError && fetchError.id === runId ? fetchError.message : null;
  const loading = Boolean(runId) && !fetchedRun && !error;
  const run = runId ? fetchedRun : lastRun;

  if (loading) return <ResultsSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <Alert variant="destructive">
          <LayersIcon />
          <AlertTitle>Could not load run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <Alert>
          <LayersIcon />
          <AlertTitle>No results yet</AlertTitle>
          <AlertDescription>
            Run a comparison or open a past run from History.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button render={<Link to="/" />}>New comparison</Button>
          <Button variant="outline" render={<Link to="/history" />}>
            History
          </Button>
        </div>
      </div>
    );
  }

  return <ResultsView run={run} />;
}

function ResultsView({ run }: { run: StoredRun }) {
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [breakpoint, setBreakpoint] = useState<string>("all");
  const [inspector, setInspector] = useState<{
    items: UrlComparisonItem[];
    index: number;
  } | null>(null);

  const breakpoints = useMemo(() => {
    const seen = new Set<string>();
    for (const item of run.results) seen.add(item.breakpoint);
    return [...seen];
  }, [run.results]);

  const filtered = useMemo(() => {
    return run.results.filter((item) => {
      if (verdict !== "all" && item.verdict !== verdict) return false;
      if (breakpoint !== "all" && item.breakpoint !== breakpoint) return false;
      if (severity !== "all") {
        const has = item.ai?.changes.some((c) => c.severity === severity);
        if (!has) return false;
      }
      return true;
    });
  }, [run.results, verdict, severity, breakpoint]);

  // Group filtered items by pair name (preserving first-seen order).
  const groups = useMemo(() => {
    const map = new Map<string, UrlComparisonItem[]>();
    for (const item of filtered) {
      const arr = map.get(item.name) ?? [];
      arr.push(item);
      map.set(item.name, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  // All items for a pair (unfiltered) so the inspector can jump across every
  // breakpoint of that pair.
  const allByPair = useMemo(() => {
    const map = new Map<string, UrlComparisonItem[]>();
    for (const item of run.results) {
      const arr = map.get(item.name) ?? [];
      arr.push(item);
      map.set(item.name, arr);
    }
    return map;
  }, [run.results]);

  const openInspector = useCallback(
    (item: UrlComparisonItem) => {
      const items = allByPair.get(item.name) ?? [item];
      const index = Math.max(
        0,
        items.findIndex((it) => it.breakpoint === item.breakpoint),
      );
      setInspector({ items, index });
    },
    [allByPair],
  );

  const copyMarkdown = useCallback(async () => {
    try {
      const res = await fetch(`/reports/${run.id}/report.md`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      toast.success("Markdown report copied to clipboard");
    } catch (err) {
      toast.error("Could not copy markdown", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [run.id]);

  const { summary } = run;

  // Older persisted runs predate the summary's usage fields, so fall back to
  // re-aggregating from the per-cell AI usage records.
  const usage = useMemo(() => {
    let calls = 0;
    let tokens = 0;
    let cost = 0;
    for (const item of run.results) {
      const u = item.ai?.usage;
      if (!u) continue;
      calls++;
      tokens += u.totalTokens;
      cost += u.costUsd ?? 0;
    }
    return {
      calls: summary.aiCalls ?? calls,
      tokens: summary.totalTokens ?? tokens,
      cost: summary.costUsd ?? cost,
    };
  }, [run.results, summary]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {formatTimestamp(run.generatedAt, run.id)} · {run.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <a
                href={`/reports/${run.id}/index.html`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <FileTextIcon data-icon="inline-start" />
            Raw HTML report
          </Button>
          <Button variant="outline" size="sm" onClick={copyMarkdown}>
            <CopyIcon data-icon="inline-start" />
            Copy markdown
          </Button>
        </div>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryStat label="comparisons" value={summary.comparisons} />
        <SummaryStat
          label="different"
          value={summary.different}
          tone="text-amber-400"
        />
        <SummaryStat
          label="errors"
          value={summary.errors}
          tone="text-destructive"
        />
        <SummaryStat
          label="changes flagged"
          value={summary.changesFlagged}
        />
        <SummaryStat
          label={`tokens · ${usage.calls} AI ${usage.calls === 1 ? "call" : "calls"}`}
          value={usage.calls > 0 ? formatTokens(usage.tokens) : "—"}
        />
        <SummaryStat
          label="ai cost"
          value={usage.calls > 0 ? formatCost(usage.cost) : "—"}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-6">
        <FilterRow label="Verdict">
          <SingleToggle
            value={verdict}
            onChange={(v) => setVerdict(v as VerdictFilter)}
            options={[
              ["all", "All"],
              ["pass", "Match"],
              ["fail", "Different"],
              ["error", "Error"],
            ]}
          />
        </FilterRow>
        <FilterRow label="Severity">
          <SingleToggle
            value={severity}
            onChange={(v) => setSeverity(v as SeverityFilter)}
            options={[
              ["all", "All"],
              ["high", "High"],
              ["medium", "Medium"],
              ["low", "Low"],
            ]}
          />
        </FilterRow>
        {breakpoints.length > 1 ? (
          <FilterRow label="Breakpoint">
            <SingleToggle
              value={breakpoint}
              onChange={setBreakpoint}
              options={[
                ["all", "All"],
                ...breakpoints.map((b) => [b, b] as [string, string]),
              ]}
            />
          </FilterRow>
        ) : null}
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <Alert>
          <LayersIcon />
          <AlertTitle>No matching comparisons</AlertTitle>
          <AlertDescription>
            No cells match the current filters. Try resetting them.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([name, items]) => (
            <section key={name} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-mono text-sm font-medium">
                  {name}
                </h2>
                <Badge variant="secondary" className="font-mono">
                  {items.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <BreakpointCard
                    key={item.breakpoint}
                    item={item}
                    onOpen={() => openInspector(item)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {inspector ? (
        <DiffViewer
          key={`${inspector.items[0]?.name}-${inspector.index}`}
          items={inspector.items}
          initialIndex={inspector.index}
          open
          onOpenChange={(open) => {
            if (!open) setInspector(null);
          }}
        />
      ) : null}
    </div>
  );
}

function BreakpointCard({
  item,
  onOpen,
}: {
  item: UrlComparisonItem;
  onOpen: () => void;
}) {
  const changes = item.ai ? sortChangesBySeverity(item.ai.changes) : [];
  return (
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="secondary" className="font-mono text-[0.7rem]">
            {item.breakpoint} · {item.width}×{item.height}
          </Badge>
          <VerdictBadge verdict={item.verdict} />
        </div>

        {item.images ? (
          <img
            src={item.images.diff}
            alt={`${item.name} ${item.breakpoint} diff`}
            className="aspect-video w-full rounded border border-border object-cover object-top"
            loading="lazy"
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
          <DecidedByBadge decidedBy={item.decidedBy} />
          <span>diff {formatRatio(item.diffRatio)}</span>
          {item.ai ? <span>conf {formatConfidence(item.ai.confidence)}</span> : null}
          {item.ai?.usage ? (
            <span>{formatTokens(item.ai.usage.totalTokens)} tok</span>
          ) : null}
          {typeof item.ai?.usage?.costUsd === "number" ? (
            <span>{formatCost(item.ai.usage.costUsd)}</span>
          ) : null}
        </div>

        {item.sizeMismatch ? (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-400"
          >
            size mismatch
          </Badge>
        ) : null}

        {item.error ? (
          <p className="line-clamp-2 text-xs text-destructive">{item.error}</p>
        ) : item.ai?.summary ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {item.ai.summary}
          </p>
        ) : null}

        {changes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {changes.slice(0, 4).map((c, i) => (
              <SeverityBadge key={i} severity={c.severity} />
            ))}
            {changes.length > 4 ? (
              <Badge variant="secondary" className="font-mono">
                +{changes.length - 4}
              </Badge>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-1 text-xs">
          <a
            href={item.baselineUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3" />
            baseline
          </a>
          <a
            href={item.currentUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3" />
            current
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function SingleToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => {
        const next = (v as string[])[0];
        if (next) onChange(next);
      }}
      variant="outline"
      size="sm"
      className="flex-wrap"
    >
      {options.map(([val, label]) => (
        <ToggleGroupItem key={val} value={val} className="text-xs">
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className={cn("font-mono text-2xl tabular-nums", tone)}>
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
      <p className="text-sm text-muted-foreground">
        Summary, per-breakpoint verdicts, and the diff inspector.
      </p>
    </header>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    </div>
  );
}
