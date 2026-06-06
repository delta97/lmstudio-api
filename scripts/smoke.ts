import sharp from "sharp";

/**
 * Smoke test for the comparison server.
 * Usage: npm run smoke   (server must be running)
 *
 * - identical images  -> expects an instant pixel-pass (no LM Studio needed)
 * - small difference   -> exercises the AI triage path (needs LM Studio + vision model)
 * - large difference   -> expects an instant pixel-fail
 */

const SERVER = process.env.COMPARE_SERVER_URL ?? "http://localhost:3100";

async function solid(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { ...rgb, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function withPatch(
  base: Buffer,
  patch: { left: number; top: number; size: number; rgb: { r: number; g: number; b: number } },
): Promise<Buffer> {
  const square = await sharp({
    create: {
      width: patch.size,
      height: patch.size,
      channels: 4,
      background: { ...patch.rgb, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{ input: square, left: patch.left, top: patch.top }])
    .png()
    .toBuffer();
}

async function compare(name: string, baseline: Buffer, current: Buffer) {
  const res = await fetch(`${SERVER}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      baselinePng: baseline.toString("base64"),
      currentPng: current.toString("base64"),
    }),
  });
  if (!res.ok) {
    throw new Error(`${name}: server error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    verdict: string;
    decidedBy: string;
    needsReview: boolean;
    pixel: { diffRatio: number };
    ai: { summary: string } | null;
  };
  console.log(
    `[${name}] verdict=${json.verdict} decidedBy=${json.decidedBy} ` +
      `diffRatio=${json.pixel.diffRatio.toFixed(4)} needsReview=${json.needsReview}` +
      (json.ai ? `\n         ai: ${json.ai.summary}` : ""),
  );
  return json;
}

async function main() {
  const blue = await solid(200, 200, { r: 40, g: 90, b: 200 });

  // 1) identical -> pixel-pass
  await compare("identical", blue, blue);

  // 2) small patch -> AI triage band (or ai-error if LM Studio is unavailable)
  const small = await withPatch(blue, {
    left: 70,
    top: 70,
    size: 24,
    rgb: { r: 220, g: 50, b: 50 },
  });
  await compare("small-change", blue, small);

  // 3) big change -> pixel-fail
  const red = await solid(200, 200, { r: 200, g: 40, b: 40 });
  await compare("large-change", blue, red);

  console.log("\nSmoke test complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
