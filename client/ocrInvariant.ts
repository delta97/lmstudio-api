import path from "node:path";
import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  isUpdateMode,
  readOcrBaseline,
  writeOcrBaseline,
  ocrBaselinePath,
} from "./ocrBaseline.js";
import { ocrImageBuffer } from "../src/ocr/ocrEngine.js";
import { normalizeOcrText, type NormalizeOptions } from "../src/ocr/normalize.js";
import { compareTexts, type CompareResult } from "../src/ocr/textDiff.js";

export interface OcrInvariantOptions {
  /** Element/page to screenshot. Defaults to the provided page (full page). */
  target?: Page | Locator;
  /** Directory holding text baselines. Defaults to __ocr_baselines__ next to the spec. */
  baselineDir?: string;
  /** Forwarded to Playwright's screenshot() call. */
  screenshot?: Parameters<Page["screenshot"]>[0];
  /** Max allowed (1 - ratio). Default 0 — any content change fails. */
  threshold?: number;
  /** Lowercase before comparing. Default false. */
  lowercase?: boolean;
  /** Strip punctuation before comparing. Default false. */
  stripPunctuation?: boolean;
}

function defaultBaselineDir(): string {
  const info = test.info();
  return path.join(path.dirname(info.file), "__ocr_baselines__");
}

async function takeScreenshot(
  page: Page,
  options: OcrInvariantOptions,
): Promise<Buffer> {
  const target = options.target ?? page;
  return target.screenshot({ ...options.screenshot });
}

/**
 * Captures a screenshot, OCRs it via the Unlimited-OCR worker, normalizes the
 * text and asserts the content is unchanged from a stored baseline. Blind to
 * styling: catches clipped/truncated/dropped text that pixel diffing buries in
 * noise during a cosmetic change. On the first run (or UPDATE_BASELINES=1) the
 * baseline is written and the assertion is skipped.
 */
export async function expectOcrInvariant(
  page: Page,
  name: string,
  options: OcrInvariantOptions = {},
): Promise<CompareResult | null> {
  const info = test.info();
  const baselineDir = options.baselineDir ?? defaultBaselineDir();
  const normalizeOpts: NormalizeOptions = {
    lowercase: options.lowercase,
    stripPunctuation: options.stripPunctuation,
  };

  const png = await takeScreenshot(page, options);
  const rawText = await ocrImageBuffer(png);
  const current = normalizeOcrText(rawText, normalizeOpts);

  const existing = await readOcrBaseline(baselineDir, name);

  if (isUpdateMode() || existing === null) {
    const file = await writeOcrBaseline(baselineDir, name, current);
    await info.attach(`${name} (ocr baseline written)`, {
      body: current,
      contentType: "text/plain",
    });
    test.info().annotations.push({
      type: "ocr-baseline",
      description: `OCR baseline ${existing === null ? "created" : "updated"}: ${file}`,
    });
    return null;
  }

  const result = compareTexts(existing, current, options.threshold ?? 0);

  await info.attach(`${name} (ocr baseline)`, {
    body: existing,
    contentType: "text/plain",
  });
  await info.attach(`${name} (ocr current)`, {
    body: current,
    contentType: "text/plain",
  });
  if (result.diffText) {
    await info.attach(`${name} (ocr diff)`, {
      body: result.diffText,
      contentType: "text/plain",
    });
  }

  const reason = buildFailureMessage(name, result);
  expect(result.pass, reason).toBe(true);

  return result;
}

function buildFailureMessage(name: string, result: CompareResult): string {
  const lines = [
    `OCR content regression detected for "${name}".`,
    `Similarity ratio: ${(result.ratio * 100).toFixed(2)}% ` +
      `(${result.removed.length} removed, ${result.added.length} added words).`,
  ];
  if (result.diffText) {
    lines.push("Word diff (- baseline / + current):");
    lines.push(result.diffText);
  }
  return lines.join("\n");
}

export { ocrBaselinePath };
