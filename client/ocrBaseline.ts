import { promises as fs } from "node:fs";
import path from "node:path";
import { isUpdateMode } from "./baseline.js";

/**
 * Read/write normalized OCR text baselines (.txt). Mirror of baseline.ts but
 * for the content-invariance check: baselines live in a sibling
 * __ocr_baselines__/ directory and store normalized text, not PNGs.
 */

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "_");
}

export function ocrBaselinePath(baselineDir: string, name: string): string {
  return path.join(baselineDir, `${sanitize(name)}.txt`);
}

export async function readOcrBaseline(
  baselineDir: string,
  name: string,
): Promise<string | null> {
  try {
    return await fs.readFile(ocrBaselinePath(baselineDir, name), "utf8");
  } catch {
    return null;
  }
}

export async function writeOcrBaseline(
  baselineDir: string,
  name: string,
  text: string,
): Promise<string> {
  await fs.mkdir(baselineDir, { recursive: true });
  const file = ocrBaselinePath(baselineDir, name);
  await fs.writeFile(file, text, "utf8");
  return file;
}

export { isUpdateMode };
