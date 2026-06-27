import { promises as fs } from "node:fs";
import path from "node:path";
import { ocrImageFile, shutdownOcr } from "../src/ocr/ocrEngine.js";
import { normalizeOcrText } from "../src/ocr/normalize.js";
import { compareTexts } from "../src/ocr/textDiff.js";

/**
 * OCR content-invariance CLI.
 *
 * Pairs images by basename across two directories, OCRs each side, normalizes
 * the text and reports content diffs — blind to styling. Exits 1 if any pair
 * exceeds the threshold.
 *
 *   npm run ocr-diff -- --before ./before --after ./after
 *   npm run ocr-diff -- --before ./before --after ./after --threshold 0.02 --lowercase
 */

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

async function listImages(dir: string): Promise<Map<string, string>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const map = new Map<string, string>();
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) continue;
    map.set(e.name, path.join(dir, e.name));
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const beforeDir = getFlag(args, "before");
  const afterDir = getFlag(args, "after");
  if (!beforeDir || !afterDir) {
    throw new Error("Usage: ocr-diff --before <dir> --after <dir> [--threshold 0] [--lowercase] [--strip-punct]");
  }

  const threshold = Number(getFlag(args, "threshold") ?? "0");
  const lowercase = args.includes("--lowercase");
  const stripPunctuation = args.includes("--strip-punct");
  const normalizeOpts = { lowercase, stripPunctuation };

  const before = await listImages(beforeDir);
  const after = await listImages(afterDir);

  const names = [...before.keys()].filter((n) => after.has(n)).sort();
  const onlyBefore = [...before.keys()].filter((n) => !after.has(n));
  const onlyAfter = [...after.keys()].filter((n) => !before.has(n));

  if (names.length === 0) {
    throw new Error(`No basename-matched image pairs between ${beforeDir} and ${afterDir}.`);
  }

  let failures = 0;
  try {
    for (const name of names) {
      const baseRaw = await ocrImageFile(before.get(name)!);
      const curRaw = await ocrImageFile(after.get(name)!);
      const baseline = normalizeOcrText(baseRaw, normalizeOpts);
      const current = normalizeOcrText(curRaw, normalizeOpts);
      const result = compareTexts(baseline, current, threshold);

      const status = result.pass ? "PASS" : "FAIL";
      console.log(`[${status}] ${name} — ratio ${(result.ratio * 100).toFixed(2)}% ` +
        `(${result.removed.length} removed, ${result.added.length} added)`);
      if (!result.pass) {
        failures++;
        console.log(result.diffText);
        console.log("");
      }
    }
  } finally {
    await shutdownOcr();
  }

  console.log("");
  for (const n of onlyBefore) console.log(`(skipped, only in --before) ${n}`);
  for (const n of onlyAfter) console.log(`(skipped, only in --after) ${n}`);
  console.log(`Summary: ${names.length} pairs, ${failures} failed, threshold ${threshold}.`);

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
