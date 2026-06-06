import { z } from "zod";

/** A rectangular region (in pixels) to ignore during pixel diffing. */
export const ignoreRegionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type IgnoreRegion = z.infer<typeof ignoreRegionSchema>;

/** Request body for POST /compare. Images are base64-encoded PNGs (no data URL prefix). */
export const compareRequestSchema = z.object({
  name: z.string().min(1).default("screenshot"),
  baselinePng: z.string().min(1),
  currentPng: z.string().min(1),
  /** Optional per-request overrides of server defaults. */
  pixelThreshold: z.number().min(0).max(1).optional(),
  maxRatio: z.number().min(0).max(1).optional(),
  ignoreRegions: z.array(ignoreRegionSchema).optional().default([]),
  /** Free-form hints for the vision model, e.g. "the clock in the header is dynamic". */
  context: z.string().optional(),
});
export type CompareRequest = z.infer<typeof compareRequestSchema>;

export interface PixelResult {
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  width: number;
  height: number;
  /** True if baseline and current had different dimensions (current was resized). */
  sizeMismatch: boolean;
}

export interface AiChange {
  region: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export interface AiVerdict {
  regression: boolean;
  confidence: number;
  summary: string;
  changes: AiChange[];
  /** Present when the model call failed and the result needs human review. */
  error?: string;
}

export type Verdict = "pass" | "fail";
export type DecidedBy = "pixel-pass" | "pixel-fail" | "ai" | "ai-error";

export interface CompareResponse {
  verdict: Verdict;
  decidedBy: DecidedBy;
  /** True when the AI call failed; verdict defaults to fail for human review. */
  needsReview: boolean;
  pixel: PixelResult;
  ai: AiVerdict | null;
  /** base64-encoded PNG highlighting the pixel differences. */
  diffPng: string;
  name: string;
}

// ---- URL comparison (POST /compare-urls) ----

export const breakpointSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const urlPairSchema = z.object({
  name: z.string().min(1).optional(),
  baselineUrl: z.string().url(),
  currentUrl: z.string().url(),
  context: z.string().optional(),
});
export type UrlPair = z.infer<typeof urlPairSchema>;

export const compareUrlsRequestSchema = z
  .object({
    /** Shorthand for a single pair. */
    baselineUrl: z.string().url().optional(),
    currentUrl: z.string().url().optional(),
    /** Or provide many pairs at once. */
    pairs: z.array(urlPairSchema).optional(),
    breakpoints: z.array(breakpointSchema).optional(),
    fullPage: z.boolean().optional(),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .optional(),
    waitMs: z.number().int().min(0).optional(),
    /** Run a headed browser (helps with some bot walls). Defaults to headless. */
    headless: z.boolean().optional(),
    /** Override the browser User-Agent. Defaults to a realistic desktop Chrome UA. */
    userAgent: z.string().optional(),
    locale: z.string().optional(),
    /** Extra HTTP headers sent with every request (e.g. cookies, auth). */
    headers: z.record(z.string()).optional(),
    pixelThreshold: z.number().min(0).max(1).optional(),
    /**
     * Defaults to 1 for URL comparisons so the vision model always describes
     * differences instead of short-circuiting to a pixel-fail.
     */
    maxRatio: z.number().min(0).max(1).optional(),
    context: z.string().optional(),
  })
  .refine(
    (d) =>
      (d.baselineUrl && d.currentUrl) || (d.pairs && d.pairs.length > 0),
    {
      message:
        "Provide either baselineUrl + currentUrl, or a non-empty pairs array.",
    },
  );
export type CompareUrlsRequest = z.infer<typeof compareUrlsRequestSchema>;

export interface UrlComparisonItem {
  name: string;
  breakpoint: string;
  width: number;
  height: number;
  baselineUrl: string;
  currentUrl: string;
  verdict: Verdict | "error";
  decidedBy: DecidedBy | "error";
  diffRatio: number;
  sizeMismatch: boolean;
  needsReview: boolean;
  ai: AiVerdict | null;
  error?: string;
  /** Paths relative to the report directory. */
  images?: { baseline: string; current: string; diff: string };
}

export interface CompareUrlsResponse {
  reportDir: string;
  reportHtml: string;
  reportMd: string;
  summary: {
    comparisons: number;
    different: number;
    errors: number;
    changesFlagged: number;
  };
  results: UrlComparisonItem[];
}
