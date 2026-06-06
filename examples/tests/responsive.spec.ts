import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test, expect, type Browser } from "@playwright/test";
import { writeReport, type BreakpointResult } from "../report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteUrl = pathToFileURL(
  path.join(here, "..", "responsive-site", "index.html"),
).href;
const reportDir = path.join(here, "..", "report");
const imagesDir = path.join(reportDir, "images");

const SERVER = process.env.COMPARE_SERVER_URL ?? "http://localhost:3100";

// Tailwind primary-CTA background colors per version, used to confirm styles applied.
const CTA_COLOR = {
  v1: "rgb(79, 70, 229)", // indigo-600
  v2: "rgb(5, 150, 105)", // emerald-600
};

const breakpoints = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const results: BreakpointResult[] = [];

async function capture(
  browser: Browser,
  bp: (typeof breakpoints)[number],
  version: 1 | 2,
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: bp.width, height: bp.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${siteUrl}?version=${version}`);
    await page.waitForLoadState("networkidle");
    const expected = version === 1 ? CTA_COLOR.v1 : CTA_COLOR.v2;
    // Wait until the Tailwind Play CDN has applied the (versioned) styles.
    await page.waitForFunction(
      (color) => {
        const el = document.getElementById("primary-cta");
        if (!el) return false;
        return getComputedStyle(el).backgroundColor === color;
      },
      expected,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(200);
    return await page.screenshot({ fullPage: true });
  } finally {
    await context.close();
  }
}

interface CompareApiResponse {
  verdict: "pass" | "fail";
  decidedBy: string;
  pixel: { diffRatio: number; sizeMismatch: boolean };
  ai: {
    summary: string;
    confidence: number;
    changes: { region: string; description: string; severity: string }[];
  } | null;
  diffPng: string;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fs.mkdir(imagesDir, { recursive: true });
});

for (const bp of breakpoints) {
  test(`${bp.name} (${bp.width}x${bp.height}) v1 vs v2`, async ({ browser }, testInfo) => {
    const baseline = await capture(browser, bp, 1);
    const current = await capture(browser, bp, 2);

    const res = await fetch(`${SERVER}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `nimbus-${bp.name}`,
        baselinePng: baseline.toString("base64"),
        currentPng: current.toString("base64"),
        context:
          `This is the Nimbus landing page rendered at the ${bp.name} breakpoint ` +
          `(${bp.width}x${bp.height}). Report every visible difference you can see ` +
          `between baseline and current at THIS breakpoint specifically: text, colors, ` +
          `labels, and any element that appears/changes only at this size.`,
      }),
    });
    expect(res.ok, `compare server responded ${res.status}`).toBeTruthy();
    const data = (await res.json()) as CompareApiResponse;

    const baselineImage = path.join("images", `${bp.name}-baseline.png`);
    const currentImage = path.join("images", `${bp.name}-current.png`);
    const diffImage = path.join("images", `${bp.name}-diff.png`);
    await fs.writeFile(path.join(reportDir, baselineImage), baseline);
    await fs.writeFile(path.join(reportDir, currentImage), current);
    await fs.writeFile(
      path.join(reportDir, diffImage),
      Buffer.from(data.diffPng, "base64"),
    );

    await testInfo.attach(`${bp.name} baseline`, {
      body: baseline,
      contentType: "image/png",
    });
    await testInfo.attach(`${bp.name} current`, {
      body: current,
      contentType: "image/png",
    });
    await testInfo.attach(`${bp.name} diff`, {
      body: Buffer.from(data.diffPng, "base64"),
      contentType: "image/png",
    });

    results.push({
      name: bp.name,
      width: bp.width,
      height: bp.height,
      verdict: data.verdict,
      decidedBy: data.decidedBy,
      diffRatio: data.pixel.diffRatio,
      sizeMismatch: data.pixel.sizeMismatch,
      ai: data.ai,
      baselineImage,
      currentImage,
      diffImage,
    });

    console.log(
      `[${bp.name}] ${data.verdict} (${data.decidedBy}) diff=${(
        data.pixel.diffRatio * 100
      ).toFixed(2)}% ${data.ai ? `- ${data.ai.summary}` : ""}`,
    );
  });
}

test.afterAll(async () => {
  if (results.length === 0) return;
  const order = { mobile: 0, tablet: 1, desktop: 2 } as Record<string, number>;
  results.sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));
  const { htmlPath, mdPath } = await writeReport(reportDir, results);
  console.log(`\nReport written:\n  ${htmlPath}\n  ${mdPath}`);
});
