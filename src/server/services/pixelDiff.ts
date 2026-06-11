import pixelmatch from "pixelmatch";
import sharp from "sharp";
import type { DiffRegion, IgnoreRegion, PixelResult } from "../types.js";

export interface PixelDiffResult {
  pixel: PixelResult;
  /** base64-encoded PNG highlighting differences (red over a dimmed baseline). */
  diffPngBase64: string;
}

interface DecodedImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Decodes a base64 PNG/JPEG into a raw RGBA buffer of a target size. */
async function decodeToRgba(
  base64: string,
  resizeTo?: { width: number; height: number },
): Promise<DecodedImage> {
  const input = Buffer.from(base64, "base64");
  let pipeline = sharp(input).ensureAlpha();

  if (resizeTo) {
    pipeline = pipeline.resize(resizeTo.width, resizeTo.height, {
      fit: "fill",
    });
  }

  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/** Zeroes out (alpha + color) the ignored regions in a raw RGBA buffer in place. */
function applyIgnoreRegions(
  img: DecodedImage,
  regions: IgnoreRegion[],
): void {
  for (const region of regions) {
    const maxX = Math.min(region.x + region.width, img.width);
    const maxY = Math.min(region.y + region.height, img.height);
    for (let y = region.y; y < maxY; y++) {
      for (let x = region.x; x < maxX; x++) {
        const idx = (y * img.width + x) * 4;
        img.data[idx] = 0;
        img.data[idx + 1] = 0;
        img.data[idx + 2] = 0;
        img.data[idx + 3] = 255;
      }
    }
  }
}

/** Cell size (px) of the coarse grid used to cluster changed pixels. */
const REGION_GRID = 32;
const MAX_REGIONS = 10;

/**
 * Clusters changed pixels (drawn pure red by pixelmatch) into approximate
 * bounding boxes via a coarse grid + flood fill, so the vision model can be
 * told exactly where to look instead of scanning the whole screenshot.
 */
function extractDiffRegions(
  diff: Buffer,
  width: number,
  height: number,
): DiffRegion[] {
  const cols = Math.ceil(width / REGION_GRID);
  const rows = Math.ceil(height / REGION_GRID);
  const counts = new Int32Array(cols * rows);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // pixelmatch marks real differences as exactly rgb(255, 0, 0);
      // anti-aliasing pixels are yellow and intentionally excluded.
      if (diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 0) {
        const cell = ((y / REGION_GRID) | 0) * cols + ((x / REGION_GRID) | 0);
        counts[cell] = (counts[cell] ?? 0) + 1;
      }
    }
  }

  const visited = new Uint8Array(cols * rows);
  const regions: DiffRegion[] = [];

  for (let cell = 0; cell < counts.length; cell++) {
    if (counts[cell] === 0 || visited[cell]) continue;

    // Flood fill over occupied cells (8-connectivity).
    let minCol = cols;
    let maxCol = -1;
    let minRow = rows;
    let maxRow = -1;
    let diffPixels = 0;
    const stack = [cell];
    visited[cell] = 1;

    while (stack.length > 0) {
      const c = stack.pop() as number;
      const col = c % cols;
      const row = (c / cols) | 0;
      diffPixels += counts[c] ?? 0;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const n = nr * cols + nc;
          if ((counts[n] ?? 0) > 0 && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
      }
    }

    const x = minCol * REGION_GRID;
    const y = minRow * REGION_GRID;
    regions.push({
      x,
      y,
      width: Math.min((maxCol + 1) * REGION_GRID, width) - x,
      height: Math.min((maxRow + 1) * REGION_GRID, height) - y,
      diffPixels,
    });
  }

  return regions
    .sort((a, b) => b.diffPixels - a.diffPixels)
    .slice(0, MAX_REGIONS);
}

export async function comparePixels(
  baselinePng: string,
  currentPng: string,
  options: {
    pixelMatchThreshold: number;
    ignoreRegions?: IgnoreRegion[];
  },
): Promise<PixelDiffResult> {
  const baseline = await decodeToRgba(baselinePng);
  const current = await decodeToRgba(currentPng, {
    width: baseline.width,
    height: baseline.height,
  });

  const sizeMismatch =
    current.width !== baseline.width || current.height !== baseline.height;

  const width = baseline.width;
  const height = baseline.height;
  const totalPixels = width * height;

  const regions = options.ignoreRegions ?? [];
  if (regions.length > 0) {
    applyIgnoreRegions(baseline, regions);
    applyIgnoreRegions(current, regions);
  }

  const diffBuffer = Buffer.alloc(totalPixels * 4);

  const diffPixels = pixelmatch(
    baseline.data,
    current.data,
    diffBuffer,
    width,
    height,
    {
      threshold: options.pixelMatchThreshold,
      includeAA: false,
      alpha: 0.3,
    },
  );

  const diffPng = await sharp(diffBuffer, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  return {
    pixel: {
      diffPixels,
      totalPixels,
      diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
      width,
      height,
      sizeMismatch,
      diffRegions:
        diffPixels > 0 ? extractDiffRegions(diffBuffer, width, height) : [],
    },
    diffPngBase64: diffPng.toString("base64"),
  };
}
