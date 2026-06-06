import path from "node:path";
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  isUpdateMode,
  readBaseline,
  writeBaseline,
  baselinePath,
} from "./baseline.js";

export interface IgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompareResponse {
  verdict: "pass" | "fail";
  decidedBy: "pixel-pass" | "pixel-fail" | "ai" | "ai-error";
  needsReview: boolean;
  pixel: {
    diffPixels: number;
    totalPixels: number;
    diffRatio: number;
    width: number;
    height: number;
    sizeMismatch: boolean;
  };
  ai: {
    regression: boolean;
    confidence: number;
    summary: string;
    changes: { region: string; description: string; severity: string }[];
    error?: string;
  } | null;
  diffPng: string;
  name: string;
}

export interface VisualMatchOptions {
  /** Element/page to screenshot. Defaults to the provided page (full page). */
  target?: Page | Locator;
  /** Directory holding baseline PNGs. Defaults to __visual_baselines__ next to the spec. */
  baselineDir?: string;
  /** Comparison server URL. Defaults to COMPARE_SERVER_URL or http://localhost:3100. */
  serverUrl?: string;
  /** Forwarded to Playwright's screenshot() call. */
  screenshot?: Parameters<Page["screenshot"]>[0];
  pixelThreshold?: number;
  maxRatio?: number;
  ignoreRegions?: IgnoreRegion[];
  /** Hints for the vision model, e.g. "the header clock is dynamic". */
  context?: string;
}

function defaultBaselineDir(): string {
  const info = test.info();
  return path.join(path.dirname(info.file), "__visual_baselines__");
}

function serverUrlFrom(options: VisualMatchOptions): string {
  return (
    options.serverUrl ??
    process.env.COMPARE_SERVER_URL ??
    "http://localhost:3100"
  );
}

async function takeScreenshot(
  page: Page,
  options: VisualMatchOptions,
): Promise<Buffer> {
  const target = options.target ?? page;
  return target.screenshot({ ...options.screenshot });
}

/**
 * Captures a screenshot and compares it against a stored baseline using the
 * LM Studio-backed comparison server. On the first run (or when
 * UPDATE_BASELINES=1) the baseline is written and the assertion is skipped.
 */
export async function expectVisualMatch(
  page: Page,
  name: string,
  options: VisualMatchOptions = {},
): Promise<CompareResponse | null> {
  const info = test.info();
  const baselineDir = options.baselineDir ?? defaultBaselineDir();
  const current = await takeScreenshot(page, options);

  const existing = await readBaseline(baselineDir, name);

  if (isUpdateMode() || !existing) {
    const file = await writeBaseline(baselineDir, name, current);
    await info.attach(`${name} (baseline written)`, {
      body: current,
      contentType: "image/png",
    });
    test.info().annotations.push({
      type: "visual-baseline",
      description: `Baseline ${existing ? "updated" : "created"}: ${file}`,
    });
    return null;
  }

  const res = await fetch(`${serverUrlFrom(options)}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      baselinePng: existing.toString("base64"),
      currentPng: current.toString("base64"),
      pixelThreshold: options.pixelThreshold,
      maxRatio: options.maxRatio,
      ignoreRegions: options.ignoreRegions,
      context: options.context,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Comparison server error (${res.status}): ${await res.text()}`,
    );
  }

  const result = (await res.json()) as CompareResponse;

  await info.attach(`${name} (baseline)`, {
    body: existing,
    contentType: "image/png",
  });
  await info.attach(`${name} (current)`, {
    body: current,
    contentType: "image/png",
  });
  await info.attach(`${name} (diff)`, {
    body: Buffer.from(result.diffPng, "base64"),
    contentType: "image/png",
  });
  await info.attach(`${name} (verdict)`, {
    body: JSON.stringify(
      {
        verdict: result.verdict,
        decidedBy: result.decidedBy,
        needsReview: result.needsReview,
        pixel: result.pixel,
        ai: result.ai,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });

  const reason = buildFailureMessage(name, result);
  expect(result.verdict, reason).toBe("pass");

  return result;
}

function buildFailureMessage(name: string, result: CompareResponse): string {
  const lines = [
    `Visual regression detected for "${name}" (decided by ${result.decidedBy}).`,
    `Pixel diff: ${result.pixel.diffPixels}/${result.pixel.totalPixels} (${(
      result.pixel.diffRatio * 100
    ).toFixed(3)}%).`,
  ];
  if (result.pixel.sizeMismatch) {
    lines.push("Dimensions differed; current was resized to baseline size.");
  }
  if (result.ai) {
    lines.push(
      `AI: ${result.ai.summary} (confidence ${result.ai.confidence}).`,
    );
    for (const c of result.ai.changes) {
      lines.push(`  - [${c.severity}] ${c.region}: ${c.description}`);
    }
  }
  if (result.needsReview) {
    lines.push("This result needs human review (AI triage failed).");
  }
  return lines.join("\n");
}

export { baselinePath };
