/**
 * Diff Inspector — a full-screen dialog for examining one comparison pair across
 * its breakpoints. Three compare modes (side-by-side, onion-skin, split-slider),
 * scroll/drag to pan, Ctrl/⌘-wheel or the toolbar buttons to zoom, breakpoint
 * jumping, and the AI change list alongside.
 *
 * Opened from the Results cards. Images come from `item.images` (root-relative
 * `/reports/...` URLs); a fallback is shown for error cells without images.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ColumnsIcon,
  ExternalLinkIcon,
  LayersIcon,
  MaximizeIcon,
  MinusIcon,
  PlusIcon,
  SplitSquareHorizontalIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DecidedByBadge,
  SeverityBadge,
  VerdictBadge,
} from "@/components/status";
import { sortChangesBySeverity } from "@/lib/status";
import { formatConfidence, formatRatio } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UrlComparisonItem } from "@/lib/types";

type CompareMode = "side-by-side" | "onion" | "split";

const MODE_ITEMS: { value: CompareMode; label: string; Icon: typeof ColumnsIcon }[] =
  [
    { value: "side-by-side", label: "Side by side", Icon: ColumnsIcon },
    { value: "onion", label: "Onion skin", Icon: LayersIcon },
    { value: "split", label: "Split", Icon: SplitSquareHorizontalIcon },
  ];

const MIN_SCALE = 1;
const MAX_SCALE = 8;

export interface DiffViewerProps {
  /** All comparison items belonging to a single pair (one per breakpoint). */
  items: UrlComparisonItem[];
  /** Index into {@link items} to open on. */
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DiffViewer({
  items,
  initialIndex = 0,
  open,
  onOpenChange,
}: DiffViewerProps) {
  // DiffViewer is mounted fresh each time it opens (Results unmounts it on
  // close), so initial props seed the state directly — no open-sync effect.
  const [index, setIndex] = useState(initialIndex);
  const [mode, setMode] = useState<CompareMode>("side-by-side");
  const [onion, setOnion] = useState(50);
  const [split, setSplit] = useState(50);
  const [scale, setScale] = useState(1);

  const stageRef = useRef<HTMLDivElement>(null);
  const splitBoxRef = useRef<HTMLDivElement>(null);
  // Pan via the stage's native scroll; a drag records the starting scroll offset.
  const dragState = useRef<{ x: number; y: number; sl: number; st: number } | null>(
    null,
  );
  // A stage-relative point to keep stationary across the next zoom step.
  const zoomAnchor = useRef<{ cx: number; cy: number; prevScale: number } | null>(
    null,
  );
  // Latest scale for the native (non-passive) wheel listener, which is bound once.
  const scaleRef = useRef(scale);

  const item = items[index] as UrlComparisonItem | undefined;

  const resetView = useCallback(() => {
    zoomAnchor.current = null;
    setScale(1);
    const el = stageRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  }, []);

  const goTo = useCallback(
    (next: number) => {
      setIndex(next);
      resetView();
    },
    [resetView],
  );

  // Zoom to `next`, keeping the (cx, cy) point — relative to the stage — fixed.
  const applyZoom = useCallback((next: number, cx: number, cy: number) => {
    setScale((prev) => {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      if (clamped === prev) return prev;
      zoomAnchor.current = { cx, cy, prevScale: prev };
      return clamped;
    });
  }, []);

  // Zoom from the toolbar buttons: anchor on the centre of the stage.
  const zoomByButton = useCallback(
    (factor: number) => {
      const el = stageRef.current;
      const cx = el ? el.clientWidth / 2 : 0;
      const cy = el ? el.clientHeight / 2 : 0;
      applyZoom(scaleRef.current * factor, cx, cy);
    },
    [applyZoom],
  );

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Plain wheel scrolls the stage natively; Ctrl/⌘ + wheel (and trackpad pinch,
  // which the browser reports as a ctrl-wheel) zooms. A native, non-passive
  // listener is required: React's onWheel is passive, so it can't
  // preventDefault the browser's page zoom.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      applyZoom(
        scaleRef.current * factor,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // After a zoom step, nudge the scroll offset so the anchored point stays put.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const el = stageRef.current;
    if (!a || !el || a.prevScale === 0) return;
    const ratio = scale / a.prevScale;
    el.scrollLeft = (el.scrollLeft + a.cx) * ratio - a.cx;
    el.scrollTop = (el.scrollTop + a.cy) * ratio - a.cy;
  }, [scale]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = stageRef.current;
      if (!el || e.button !== 0) return;
      dragState.current = {
        x: e.clientX,
        y: e.clientY,
        sl: el.scrollLeft,
        st: el.scrollTop,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragState.current;
      const el = stageRef.current;
      if (!start || !el) return;
      el.scrollLeft = start.sl - (e.clientX - start.x);
      el.scrollTop = start.st - (e.clientY - start.y);
    },
    [],
  );

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onSplitDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const move = (clientX: number) => {
      const rect = splitBoxRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(100, Math.max(0, pct)));
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const changes = useMemo(
    () => (item?.ai ? sortChangesBySeverity(item.ai.changes) : []),
    [item],
  );

  const pairName = item?.name ?? "Comparison";
  const hasImages = Boolean(item?.images);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-3 p-4 sm:max-w-[96vw]"
      >
        <DialogHeader className="gap-1">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="truncate font-mono">{pairName}</DialogTitle>
              <DialogDescription className="sr-only">
                Visual diff inspector for {pairName}. Compare baseline and current
                screenshots across breakpoints.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                value={[mode]}
                onValueChange={(v) => {
                  const next = (v as CompareMode[])[0];
                  if (next) setMode(next);
                }}
                variant="outline"
                size="sm"
              >
                {MODE_ITEMS.map(({ value, label, Icon }) => (
                  <ToggleGroupItem key={value} value={value} aria-label={label}>
                    <Icon data-icon="inline-start" />
                    <span className="hidden sm:inline">{label}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => zoomByButton(1 / 1.4)}
                  aria-label="Zoom out"
                >
                  <MinusIcon />
                </Button>
                <span className="w-12 text-center font-mono text-xs text-muted-foreground tabular-nums">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => zoomByButton(1.4)}
                  aria-label="Zoom in"
                >
                  <PlusIcon />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={resetView}
                  aria-label="Reset view"
                >
                  <MaximizeIcon />
                </Button>
              </div>
            </div>
          </div>

          {items.length > 1 ? (
            <ToggleGroup
              value={item ? [item.breakpoint] : []}
              onValueChange={(v) => {
                const next = (v as string[])[0];
                const i = items.findIndex((it) => it.breakpoint === next);
                if (i >= 0) goTo(i);
              }}
              variant="outline"
              size="sm"
              className="mt-1 flex-wrap"
            >
              {items.map((it) => (
                <ToggleGroupItem
                  key={it.breakpoint}
                  value={it.breakpoint}
                  className="font-mono text-xs"
                >
                  {it.breakpoint}
                  <span className="text-muted-foreground">
                    {it.width}×{it.height}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          {/* Viewer stage */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {mode === "onion" && hasImages ? (
              <div className="flex items-center gap-3 px-1">
                <span className="font-mono text-xs text-muted-foreground">
                  baseline
                </span>
                <Slider
                  value={onion}
                  onValueChange={(v) => setOnion(v as number)}
                  min={0}
                  max={100}
                  className="flex-1"
                  aria-label="Onion-skin blend"
                />
                <span className="font-mono text-xs text-muted-foreground">
                  current
                </span>
              </div>
            ) : null}

            <div
              ref={stageRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPan}
              onPointerLeave={endPan}
              className={cn(
                "relative min-h-0 flex-1 overflow-auto rounded-lg bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] ring-1 ring-border",
                "cursor-grab active:cursor-grabbing",
              )}
            >
              {!hasImages || !item?.images ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {item?.error
                    ? `No images — this cell errored: ${item.error}`
                    : "No images available for this cell."}
                </div>
              ) : (
                <div
                  className="w-max p-2"
                  style={{ zoom: scale } as unknown as CSSProperties}
                >
                  {mode === "side-by-side" ? (
                    <div className="flex items-start gap-2">
                      {(
                        [
                          ["baseline", item.images.baseline],
                          ["current", item.images.current],
                          ["diff", item.images.diff],
                        ] as const
                      ).map(([label, src]) => (
                        <figure
                          key={label}
                          className="flex flex-col gap-1 overflow-hidden rounded-md ring-1 ring-border"
                        >
                          <figcaption className="bg-card px-2 py-1 font-mono text-[0.7rem] text-muted-foreground">
                            {label}
                          </figcaption>
                          <img
                            src={src}
                            alt={`${label} screenshot`}
                            className="block w-80 max-w-none select-none bg-card"
                            draggable={false}
                          />
                        </figure>
                      ))}
                    </div>
                  ) : mode === "onion" ? (
                    <div className="relative w-[40rem] max-w-none">
                      <img
                        src={item.images.baseline}
                        alt="baseline screenshot"
                        className="block w-full select-none"
                        draggable={false}
                      />
                      <img
                        src={item.images.current}
                        alt="current screenshot"
                        className="absolute inset-0 block size-full select-none object-fill"
                        style={{ opacity: onion / 100 }}
                        draggable={false}
                      />
                    </div>
                  ) : (
                    <div
                      ref={splitBoxRef}
                      className="relative w-[40rem] max-w-none select-none"
                    >
                      <img
                        src={item.images.baseline}
                        alt="baseline screenshot"
                        className="block w-full select-none"
                        draggable={false}
                      />
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                      >
                        <img
                          src={item.images.current}
                          alt="current screenshot"
                          className="absolute inset-0 block size-full select-none object-fill"
                          draggable={false}
                        />
                      </div>
                      <div
                        className="absolute inset-y-0 z-10 -ml-px w-0.5 cursor-ew-resize bg-primary"
                        style={{ left: `${split}%` }}
                        onPointerDown={onSplitDrag}
                      >
                        <span className="absolute top-1/2 left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <SplitSquareHorizontalIcon className="size-3.5" />
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
            {item ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={item.verdict} />
                  <DecidedByBadge decidedBy={item.decidedBy} />
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                  <Metric label="diff ratio" value={formatRatio(item.diffRatio)} />
                  <Metric
                    label="confidence"
                    value={
                      item.ai ? formatConfidence(item.ai.confidence) : "—"
                    }
                  />
                  <Metric label="breakpoint" value={item.breakpoint} />
                  <Metric label="size" value={`${item.width}×${item.height}`} />
                </div>
                {item.sizeMismatch ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-amber-400"
                  >
                    size mismatch — current was resized
                  </Badge>
                ) : null}

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">AI changes</span>
                  <Badge variant="secondary" className="font-mono">
                    {changes.length}
                  </Badge>
                </div>
                {item.ai?.summary ? (
                  <p className="text-sm text-muted-foreground">
                    {item.ai.summary}
                  </p>
                ) : null}

                <ScrollArea className="min-h-0 flex-1">
                  <ul className="flex flex-col gap-2 pr-3">
                    {changes.map((c, i) => (
                      <li
                        key={i}
                        className="flex flex-col gap-1 rounded-md bg-muted/40 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[0.7rem] text-muted-foreground">
                            {c.region}
                          </span>
                          <SeverityBadge severity={c.severity} />
                        </div>
                        <p className="text-sm">{c.description}</p>
                      </li>
                    ))}
                    {changes.length === 0 ? (
                      <li className="text-sm text-muted-foreground">
                        No specific changes reported.
                      </li>
                    ) : null}
                  </ul>
                </ScrollArea>

                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <a
                        href={item.baselineUrl}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    Open baseline
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <a
                        href={item.currentUrl}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    Open current
                  </Button>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5">
      <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}
