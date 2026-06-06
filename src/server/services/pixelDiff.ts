import pixelmatch from "pixelmatch";
import sharp from "sharp";
import type { IgnoreRegion, PixelResult } from "../types.js";

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
    },
    diffPngBase64: diffPng.toString("base64"),
  };
}
