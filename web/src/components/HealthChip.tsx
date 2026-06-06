/**
 * LM Studio health indicator. Polls GET /health and shows reachability + whether
 * the configured vision model is loaded. Warns when the model is not loaded.
 */

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleSlashIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHealth } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

export function HealthChip() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const health = await getHealth();
        if (mounted.current) setState({ kind: "ok", health });
      } catch (err) {
        if (mounted.current)
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "unreachable",
          });
      } finally {
        if (mounted.current) timer = setTimeout(poll, POLL_MS);
      }
    };
    poll();

    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Spinner className="size-3" />
        Checking LM Studio…
      </Badge>
    );
  }

  if (state.kind === "error") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              className="border-destructive/30 bg-destructive/10 text-destructive"
            />
          }
        >
          <CircleSlashIcon data-icon="inline-start" />
          LM Studio unreachable
        </TooltipTrigger>
        <TooltipContent>{state.message}</TooltipContent>
      </Tooltip>
    );
  }

  const { lmStudio } = state.health;
  const reachable = lmStudio.reachable;
  const modelLoaded = lmStudio.modelLoaded;

  const tone = !reachable
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : modelLoaded
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : "border-amber-500/30 bg-amber-500/10 text-amber-400";

  const Icon = !reachable
    ? CircleSlashIcon
    : modelLoaded
      ? CheckCircle2Icon
      : CircleAlertIcon;

  const label = !reachable
    ? "LM Studio unreachable"
    : modelLoaded
      ? "Model loaded"
      : "Model not loaded";

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="outline" className={cn(tone)} />}
      >
        <Icon data-icon="inline-start" />
        {label}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="flex flex-col gap-1 text-left">
          <span className="font-mono text-[0.7rem]">{lmStudio.baseUrl}</span>
          <span>
            Configured model:{" "}
            <span className="font-mono">{lmStudio.configuredModel}</span>
          </span>
          {!modelLoaded && reachable ? (
            <span>
              The configured vision model is not loaded — load it in LM Studio
              for AI triage to work.
            </span>
          ) : null}
          {lmStudio.availableModels.length > 0 ? (
            <span className="text-muted-foreground">
              {lmStudio.availableModels.length} model
              {lmStudio.availableModels.length === 1 ? "" : "s"} available
            </span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
