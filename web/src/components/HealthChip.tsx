/**
 * LLM backend health indicator. Polls GET /health and shows reachability +
 * whether the configured vision model is available (loaded in LM Studio, or
 * present in the OpenRouter catalog). Warns when the model is not available.
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
        Checking AI backend…
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
          AI backend unreachable
        </TooltipTrigger>
        <TooltipContent>{state.message}</TooltipContent>
      </Tooltip>
    );
  }

  // `llm` is the current key; fall back to `lmStudio` for older servers.
  const llm = state.health.llm ?? state.health.lmStudio;
  const providerName =
    llm.provider === "openrouter" ? "OpenRouter" : "LM Studio";
  const reachable = llm.reachable;
  const modelLoaded = llm.modelLoaded;

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
    ? `${providerName} unreachable`
    : modelLoaded
      ? "Model available"
      : "Model not available";

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
          <span className="font-mono text-[0.7rem]">{llm.baseUrl}</span>
          <span>
            Configured model:{" "}
            <span className="font-mono">{llm.configuredModel}</span>
          </span>
          {!modelLoaded && reachable ? (
            <span>
              {llm.provider === "openrouter"
                ? "The configured model id was not found in the OpenRouter catalog — check OPENROUTER_MODEL."
                : "The configured vision model is not loaded — load it in LM Studio for AI triage to work."}
            </span>
          ) : null}
          {llm.error ? (
            <span className="text-destructive">{llm.error}</span>
          ) : null}
          {llm.availableModels.length > 0 ? (
            <span className="text-muted-foreground">
              {llm.availableModels.length} model
              {llm.availableModels.length === 1 ? "" : "s"} available
            </span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
