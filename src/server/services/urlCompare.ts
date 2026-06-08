import sharp from "sharp";
import { config } from "../config.js";
import type {
  AiVerdict,
  CompareUrlsRequest,
  DecidedBy,
  UrlComparisonItem,
  UrlPair,
  Verdict,
} from "../types.js";
import {
  DEFAULT_BREAKPOINTS,
  DEFAULT_CAPTURE_OPTIONS,
  captureUrl,
  withBrowser,
  type Breakpoint,
  type CaptureOptions,
} from "./capture.js";
import type { CellThumbnails, CompareEventHandler } from "./events.js";
import { comparePixels } from "./pixelDiff.js";
import { triageWithVision } from "./lmstudio.js";

export interface RawComparison {
  item: Omit<UrlComparisonItem, "images">;
  baseline?: Buffer;
  current?: Buffer;
  diff?: Buffer;
}

function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.host) return u.host;
    const segments = u.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || "comparison";
  } catch {
    return "comparison";
  }
}

function normalizePairs(req: CompareUrlsRequest): UrlPair[] {
  if (req.pairs && req.pairs.length > 0) {
    return req.pairs.map((p, i) => ({
      ...p,
      name: p.name ?? `pair-${i + 1}`,
    }));
  }
  // refine() guarantees these exist when pairs is absent.
  return [
    {
      name: hostLabel(req.currentUrl as string),
      baselineUrl: req.baselineUrl as string,
      currentUrl: req.currentUrl as string,
    },
  ];
}

function buildContext(
  pair: UrlPair,
  bp: Breakpoint,
  globalContext?: string,
): string {
  return [
    `Comparing two versions of a web page at the ${bp.name} breakpoint (${bp.width}x${bp.height}).`,
    `Baseline URL: ${pair.baselineUrl}`,
    `Current URL: ${pair.currentUrl}`,
    "Report every visible difference between baseline and current at THIS breakpoint: text, colors, layout, spacing, images, and any element that appears or changes only at this size.",
    pair.context,
    globalContext,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Small JPEG preview as a data URL, for live UI thumbnails. */
async function thumbnail(buf: Buffer): Promise<string> {
  const out = await sharp(buf)
    .resize({ width: 480, withoutEnlargement: true })
    .jpeg({ quality: 60 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

interface CellOutcome {
  verdict: Verdict;
  decidedBy: DecidedBy;
  needsReview: boolean;
  ai: AiVerdict | null;
  diffRatio: number;
  sizeMismatch: boolean;
  diff: Buffer;
}

/**
 * Runs the pixel diff and, only when the ratio lands in the triage band,
 * the AI vision step. Mirrors verdict.ts's compare() but exposes the
 * pixel/AI boundary so the caller can emit an accurate 'ai-reviewing' stage.
 */
async function diffAndTriage(
  baseline: Buffer,
  current: Buffer,
  req: CompareUrlsRequest,
  context: string,
  onAiStart: () => void,
): Promise<CellOutcome> {
  const pixelThreshold = req.pixelThreshold ?? config.diff.pixelThreshold;
  // Default to 1 so any real difference is described by the model.
  const maxRatio = req.maxRatio ?? 1;

  const { pixel, diffPngBase64 } = await comparePixels(
    baseline.toString("base64"),
    current.toString("base64"),
    {
      pixelMatchThreshold: config.diff.pixelMatchThreshold,
      ignoreRegions: [],
    },
  );
  const diff = Buffer.from(diffPngBase64, "base64");
  const common = {
    diffRatio: pixel.diffRatio,
    sizeMismatch: pixel.sizeMismatch,
    diff,
  };

  if (pixel.diffRatio <= pixelThreshold) {
    return {
      ...common,
      verdict: "pass",
      decidedBy: "pixel-pass",
      needsReview: false,
      ai: null,
    };
  }

  if (pixel.diffRatio >= maxRatio) {
    return {
      ...common,
      verdict: "fail",
      decidedBy: "pixel-fail",
      needsReview: false,
      ai: null,
    };
  }

  onAiStart();
  try {
    const ai = await triageWithVision({
      baselinePng: baseline.toString("base64"),
      currentPng: current.toString("base64"),
      diffPng: diffPngBase64,
      diffRatio: pixel.diffRatio,
      context,
    });
    return {
      ...common,
      verdict: ai.regression ? "fail" : "pass",
      decidedBy: "ai",
      needsReview: false,
      ai,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fail closed: an AI error becomes a "needs human review" failure rather
    // than a silent pass, so regressions are never hidden by infra problems.
    return {
      ...common,
      verdict: "fail",
      decidedBy: "ai-error",
      needsReview: true,
      ai: {
        regression: true,
        confidence: 0,
        summary: `Vision triage failed; flagged for human review. ${message}`,
        changes: [],
        error: message,
      },
    };
  }
}

export async function compareUrls(
  req: CompareUrlsRequest,
  onEvent?: CompareEventHandler,
): Promise<RawComparison[]> {
  const pairs = normalizePairs(req);
  const breakpoints: Breakpoint[] = req.breakpoints ?? DEFAULT_BREAKPOINTS;
  const options: CaptureOptions = {
    ...DEFAULT_CAPTURE_OPTIONS,
    fullPage: req.fullPage ?? DEFAULT_CAPTURE_OPTIONS.fullPage,
    waitUntil: req.waitUntil ?? DEFAULT_CAPTURE_OPTIONS.waitUntil,
    waitMs: req.waitMs ?? DEFAULT_CAPTURE_OPTIONS.waitMs,
    headless: req.headless ?? DEFAULT_CAPTURE_OPTIONS.headless,
    userAgent: req.userAgent ?? DEFAULT_CAPTURE_OPTIONS.userAgent,
    locale: req.locale ?? DEFAULT_CAPTURE_OPTIONS.locale,
    headers: req.headers,
  };

  const out: RawComparison[] = [];

  // Cumulative counters, emitted after each cell.
  let different = 0;
  let errors = 0;
  let changesFlagged = 0;
  const emitSummary = (): void => {
    onEvent?.({
      type: "summary:update",
      comparisons: out.length,
      different,
      errors,
      changesFlagged,
    });
  };

  onEvent?.({
    type: "run:start",
    totalCells: pairs.length * breakpoints.length,
    pairs: pairs.map((p) => ({
      name: p.name as string,
      baselineUrl: p.baselineUrl,
      currentUrl: p.currentUrl,
    })),
    breakpoints: breakpoints.map((b) => ({
      name: b.name,
      width: b.width,
      height: b.height,
    })),
  });

  // Setting up: launching the browser can take a moment before the first
  // capture, so surface it as a run-level phase rather than a frozen screen.
  onEvent?.({ type: "run:phase", phase: "launching" });

  await withBrowser({ headless: options.headless }, async (browser) => {
    // Browser is ready; the per-cell capture/diff/review work begins.
    onEvent?.({ type: "run:phase", phase: "capturing" });
    for (const pair of pairs) {
      for (const bp of breakpoints) {
        const name = pair.name as string;
        const baseMeta = {
          name,
          breakpoint: bp.name,
          width: bp.width,
          height: bp.height,
          baselineUrl: pair.baselineUrl,
          currentUrl: pair.currentUrl,
        };

        onEvent?.({
          type: "cell:start",
          name,
          breakpoint: bp.name,
          width: bp.width,
          height: bp.height,
        });

        try {
          onEvent?.({
            type: "cell:stage",
            name,
            breakpoint: bp.name,
            stage: "capturing-baseline",
          });
          const baseline = await captureUrl(
            browser,
            pair.baselineUrl,
            bp,
            options,
          );

          onEvent?.({
            type: "cell:stage",
            name,
            breakpoint: bp.name,
            stage: "capturing-current",
          });
          const current = await captureUrl(
            browser,
            pair.currentUrl,
            bp,
            options,
          );

          onEvent?.({
            type: "cell:stage",
            name,
            breakpoint: bp.name,
            stage: "pixel-diffing",
          });
          const outcome = await diffAndTriage(
            baseline,
            current,
            req,
            buildContext(pair, bp, req.context),
            () =>
              onEvent?.({
                type: "cell:stage",
                name,
                breakpoint: bp.name,
                stage: "ai-reviewing",
              }),
          );

          const item: Omit<UrlComparisonItem, "images"> = {
            ...baseMeta,
            verdict: outcome.verdict,
            decidedBy: outcome.decidedBy,
            diffRatio: outcome.diffRatio,
            sizeMismatch: outcome.sizeMismatch,
            needsReview: outcome.needsReview,
            ai: outcome.ai,
          };

          out.push({
            item,
            baseline,
            current,
            diff: outcome.diff,
          });

          if (outcome.verdict === "fail") different++;
          changesFlagged += outcome.ai?.changes.length ?? 0;

          const thumbnails: CellThumbnails = {
            baseline: await thumbnail(baseline),
            current: await thumbnail(current),
            diff: await thumbnail(outcome.diff),
          };
          onEvent?.({ type: "cell:done", item, thumbnails });
          emitSummary();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          out.push({
            item: {
              ...baseMeta,
              verdict: "error",
              decidedBy: "error",
              diffRatio: 0,
              sizeMismatch: false,
              needsReview: true,
              ai: null,
              error: message,
            },
          });
          errors++;
          onEvent?.({
            type: "cell:error",
            name,
            breakpoint: bp.name,
            error: message,
          });
          emitSummary();
        }
      }
    }
  });

  return out;
}
