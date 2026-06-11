import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  HistoryIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getRun, listRuns } from "@/lib/api";
import {
  formatCost,
  formatRelative,
  formatTimestamp,
  formatTokens,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Breakpoint,
  CompareUrlsRequest,
  RunListItem,
  UrlPair,
} from "@/lib/types";
import type { SetupNavState } from "@/pages/SetupPage";

export default function HistoryPage() {
  const navigate = useNavigate();

  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);

  const fetchRuns = useCallback(
    (signal?: { aborted: boolean }) =>
      listRuns()
        .then((r) => {
          if (!signal?.aborted) setRuns(r);
        })
        .catch((err: unknown) => {
          if (!signal?.aborted)
            setError(err instanceof Error ? err.message : "Failed to load runs");
        }),
    [],
  );

  const reload = useCallback(() => {
    setRuns(null);
    setError(null);
    void fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    const signal = { aborted: false };
    void fetchRuns(signal);
    return () => {
      signal.aborted = true;
    };
  }, [fetchRuns]);

  const handleRerun = useCallback(
    async (id: string) => {
      setRerunning(id);
      try {
        const run = await getRun(id);
        const pairsMap = new Map<string, UrlPair>();
        const bpMap = new Map<string, Breakpoint>();
        for (const item of run.results) {
          if (!pairsMap.has(item.name)) {
            pairsMap.set(item.name, {
              name: item.name,
              baselineUrl: item.baselineUrl,
              currentUrl: item.currentUrl,
            });
          }
          if (!bpMap.has(item.breakpoint)) {
            bpMap.set(item.breakpoint, {
              name: item.breakpoint,
              width: item.width,
              height: item.height,
            });
          }
        }
        const config: CompareUrlsRequest = {
          pairs: [...pairsMap.values()],
          breakpoints: [...bpMap.values()],
        };
        navigate("/", { state: { prefill: config } satisfies SetupNavState });
        toast.success("Loaded run into setup", {
          description: "Adjust options and run again.",
        });
      } catch (err) {
        toast.error("Could not load run for re-run", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRerunning(null);
      }
    },
    [navigate],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            Past comparison runs, newest first.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </header>

      {error ? (
        <Alert variant="destructive">
          <HistoryIcon />
          <AlertTitle>Could not load history</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : runs === null ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <Alert>
          <HistoryIcon />
          <AlertTitle>No runs yet</AlertTitle>
          <AlertDescription>
            Completed comparisons will appear here.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              rerunning={rerunning === run.id}
              onOpen={() => navigate(`/results/${run.id}`)}
              onRerun={() => handleRerun(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  rerunning,
  onOpen,
  onRerun,
}: {
  run: RunListItem;
  rerunning: boolean;
  onOpen: () => void;
  onRerun: () => void;
}) {
  const { summary, pairs } = run;
  const clean = summary.different === 0 && summary.errors === 0;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {formatRelative(run.generatedAt, run.id)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatTimestamp(run.generatedAt, run.id)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {pairs.slice(0, 3).map((p) => (
              <Badge
                key={p.name}
                variant="secondary"
                className="font-mono text-[0.7rem]"
              >
                {p.name}
              </Badge>
            ))}
            {pairs.length > 3 ? (
              <Badge variant="secondary" className="font-mono text-[0.7rem]">
                +{pairs.length - 3}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
            <Badge variant="outline">{summary.comparisons} total</Badge>
            <Badge
              variant="outline"
              className={cn(
                summary.different > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "text-muted-foreground",
              )}
            >
              {summary.different} diff
            </Badge>
            {summary.errors > 0 ? (
              <Badge
                variant="outline"
                className="border-destructive/30 bg-destructive/10 text-destructive"
              >
                {summary.errors} err
              </Badge>
            ) : null}
            {clean ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              >
                clean
              </Badge>
            ) : null}
            {(summary.totalTokens ?? 0) > 0 ? (
              <Badge variant="outline" className="text-muted-foreground">
                {formatTokens(summary.totalTokens ?? 0)} tok
                {typeof summary.costUsd === "number"
                  ? ` · ${formatCost(summary.costUsd)}`
                  : ""}
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Re-run this configuration"
              disabled={rerunning}
              onClick={(e) => {
                e.stopPropagation();
                onRerun();
              }}
            >
              {rerunning ? (
                <RotateCcwIcon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open run"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            >
              <ArrowRightIcon />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
