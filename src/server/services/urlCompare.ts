import type {
  CompareUrlsRequest,
  UrlComparisonItem,
  UrlPair,
} from "../types.js";
import {
  DEFAULT_BREAKPOINTS,
  DEFAULT_CAPTURE_OPTIONS,
  captureUrl,
  withBrowser,
  type Breakpoint,
  type CaptureOptions,
} from "./capture.js";
import { compare } from "./verdict.js";

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

export async function compareUrls(
  req: CompareUrlsRequest,
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

  await withBrowser({ headless: options.headless }, async (browser) => {
    for (const pair of pairs) {
      for (const bp of breakpoints) {
        const baseMeta = {
          name: pair.name as string,
          breakpoint: bp.name,
          width: bp.width,
          height: bp.height,
          baselineUrl: pair.baselineUrl,
          currentUrl: pair.currentUrl,
        };

        try {
          const baseline = await captureUrl(browser, pair.baselineUrl, bp, options);
          const current = await captureUrl(browser, pair.currentUrl, bp, options);

          const result = await compare({
            name: `${pair.name}-${bp.name}`,
            baselinePng: baseline.toString("base64"),
            currentPng: current.toString("base64"),
            pixelThreshold: req.pixelThreshold,
            // Default to 1 so any real difference is described by the model.
            maxRatio: req.maxRatio ?? 1,
            ignoreRegions: [],
            context: buildContext(pair, bp, req.context),
          });

          out.push({
            item: {
              ...baseMeta,
              verdict: result.verdict,
              decidedBy: result.decidedBy,
              diffRatio: result.pixel.diffRatio,
              sizeMismatch: result.pixel.sizeMismatch,
              needsReview: result.needsReview,
              ai: result.ai,
            },
            baseline,
            current,
            diff: Buffer.from(result.diffPng, "base64"),
          });
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
        }
      }
    }
  });

  return out;
}
