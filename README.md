# LM Studio Visual Regression Pipeline

A local visual regression testing pipeline for Playwright, backed by a vision model running in [LM Studio](https://lmstudio.ai/docs/developer/rest).

> **New here? Start with the [Quickstart](./QUICKSTART.md)** — it walks through installing LM Studio (macOS/Windows), downloading the Gemma-4-12B vision model, and running everything end to end.

It has two parts:

1. A stateless **comparison server** (Node/TypeScript + Express) that wraps the LM Studio API and exposes `POST /compare`.
2. A **Playwright client helper** (`expectVisualMatch`) that captures screenshots, manages baselines, calls the server, and asserts the verdict — attaching the baseline, current, diff, and AI reasoning to the Playwright HTML report.

## How it decides pass/fail (hybrid)

```
diffRatio = changed pixels / total pixels   (computed with pixelmatch)

diffRatio <= PIXEL_THRESHOLD   ->  PASS instantly        (no model call)
diffRatio >= MAX_RATIO         ->  FAIL instantly        (no model call)
in between                     ->  vision model triages  (regression vs. noise)
```

The vision model receives the baseline, the current screenshot, and the diff overlay, then returns a structured JSON verdict (`regression`, `confidence`, `summary`, `changes[]`) via LM Studio's [structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output). This filters out acceptable noise (anti-aliasing, sub-pixel font hinting, dynamic timestamps) while catching real regressions (moved/missing elements, color/layout/text changes).

If the model call fails, the comparison **fails closed** (`needsReview: true`) rather than silently passing.

## Prerequisites

- Node.js 18+ (developed against Node 26).
- [LM Studio](https://lmstudio.ai) running locally with the server on (`lms server start`, default `http://localhost:1234`).
- A **vision-capable** model loaded. Small models (<7B) are unreliable for structured output, so prefer a capable VLM:

```bash
lms get qwen/qwen3-vl-4b      # or any vision model you prefer
lms server start
```

Any multimodal model that supports structured output works (e.g. `qwen/qwen3-vl-*`, `google/gemma-4-12b`). Set it via `LMSTUDIO_MODEL`.

## Setup

```bash
npm install
cp .env.example .env          # then edit LMSTUDIO_MODEL etc.
npx playwright install chromium   # only needed to run the example
```

## Run the server

```bash
npm run dev      # watch mode (tsx)
# or
npm start

# Verify it can reach LM Studio:
curl http://localhost:3100/health
```

`GET /health` reports whether LM Studio is reachable, the configured model, and whether it is loaded.

## Smoke test

With the server running:

```bash
npm run smoke
```

This generates synthetic images and exercises all three paths (instant pixel-pass, AI triage, instant pixel-fail).

## Use it in your Playwright tests

```ts
import { test } from "@playwright/test";
import { expectVisualMatch } from "<path-to>/client/visualMatch.js";

test("homepage looks right", async ({ page }) => {
  await page.goto("https://example.com");

  await expectVisualMatch(page, "homepage", {
    // optional: screenshot a specific element instead of the full page
    target: page.locator("main"),
    // optional: tell the model what is allowed to change
    context: "The hero carousel rotates; ignore which slide is shown.",
    // optional: mask dynamic regions before diffing
    ignoreRegions: [{ x: 0, y: 0, width: 200, height: 40 }],
  });
});
```

- **First run** (or any time the baseline is missing) writes the baseline and skips the assertion.
- Baselines are stored in `__visual_baselines__/` next to the spec file — commit them to version control.
- To intentionally update baselines: `UPDATE_BASELINES=1 npx playwright test`.
- Point the helper at a remote server with `COMPARE_SERVER_URL` (or the `serverUrl` option).

### `expectVisualMatch(page, name, options)`

| Option | Description |
| --- | --- |
| `target` | `Page` or `Locator` to screenshot (default: full page) |
| `baselineDir` | Override the baseline directory |
| `serverUrl` | Comparison server URL (default `COMPARE_SERVER_URL` or `http://localhost:3100`) |
| `screenshot` | Options forwarded to Playwright's `screenshot()` |
| `pixelThreshold` | Per-call override of the instant-pass threshold |
| `maxRatio` | Per-call override of the instant-fail threshold |
| `ignoreRegions` | Rectangles `{x,y,width,height}` masked before diffing |
| `context` | Free-form hints for the vision model |

## Run the example

The example renders a deterministic card offline (via `setContent`) so it needs no website.

```bash
npm start                                   # in one terminal
npm run test:example                        # run 1: creates the baseline
npm run test:example                        # run 2: passes (unchanged)
INTRODUCE_REGRESSION=1 npm run test:example # run 3: fails via AI triage
```

Open `examples/playwright-report/index.html` to see the attached baseline/current/diff images and the AI verdict.

## Responsive breakpoint example

A richer, immersive demo lives in `examples/responsive-site/index.html`: a responsive Tailwind + JS landing page ("Nimbus"). A `?version=2` query parameter applies a second variant with:

- Global changes (all breakpoints): primary CTA color + label, a hero subheading word, a stat value.
- A mobile-only change (the `Free trial` badge text, rendered only below `sm`).
- A tablet-only change (the promo banner text + color, rendered only `md..lg`).
- A desktop-only change (the `Enterprise` nav link, rendered only `lg+`).

`examples/tests/responsive.spec.ts` captures full-page screenshots of v1 (baseline) and v2 (current) at three viewports — mobile (390x844), tablet (768x1024), desktop (1440x900) — sends each pair to the vision model, and writes a consolidated report.

```bash
npm start                 # comparison server in one terminal
npm run test:responsive   # captures, compares, and writes the report
```

Outputs (under `examples/report/`, gitignored):
- `index.html` — a visual report with baseline/current/diff side-by-side and the AI's per-breakpoint findings.
- `report.md` — the same findings in Markdown.
- `images/` — the captured screenshots and diffs.

Because the breakpoint-only elements are only rendered at their size, the vision model reports them only at the relevant breakpoint (e.g. the tablet promo banner appears only in the tablet section). This page uses the Tailwind Play CDN, so an internet connection is required when running it.

## Compare two live URLs

Instead of capturing screenshots in your own Playwright tests, you can hand the server two URLs (or many pairs) and let it drive a headless browser itself. It loads each URL across breakpoints, runs the same hybrid comparison, and writes a report.

### CLI

```bash
npm start   # server in one terminal

# Compare two URLs across mobile/tablet/desktop:
npm run compare-urls -- https://baseline.example.com https://current.example.com

# Options:
npm run compare-urls -- <baselineUrl> <currentUrl> \
  --name homepage --bp mobile,desktop --no-full-page --wait-until load --max-ratio 1 \
  --headed --user-agent "Mozilla/5.0 ... Chrome/148.0.0.0 Safari/537.36"

# Or drive it from a JSON request body (multiple pairs, custom breakpoints):
npm run compare-urls -- --config ./pairs.json
```

Example `pairs.json`:

```json
{
  "pairs": [
    { "name": "home", "baselineUrl": "https://prod.example.com", "currentUrl": "https://staging.example.com" },
    { "name": "pricing", "baselineUrl": "https://prod.example.com/pricing", "currentUrl": "https://staging.example.com/pricing" }
  ],
  "breakpoints": [
    { "name": "mobile", "width": 390, "height": 844 },
    { "name": "tablet", "width": 768, "height": 1024 },
    { "name": "desktop", "width": 1440, "height": 900 }
  ],
  "fullPage": true
}
```

The CLI prints a per-breakpoint summary and the path to the generated report. Reports are written to `reports/<timestamp>/` (gitignored) with `index.html`, `report.md`, and an `images/` folder.

### Bot protection

Some sites (CloudFront/Akamai/Cloudflare-fronted) block automated browsers. By default the server sends a realistic desktop Chrome User-Agent (Playwright's default contains `HeadlessChrome`, which trips many bot walls) and launches with `--disable-blink-features=AutomationControlled`. If a site still serves a 403 / challenge page, try:

- `--headed` (or `"headless": false`) to run a visible browser.
- `--user-agent "<a UA that matches your real browser>"`.
- Passing cookies/headers via the `headers` field in a `--config` JSON (e.g. an authenticated session cookie).

The captured screenshots in the report show exactly what the browser received, so a 403/challenge page will be visible there.

> Note: `POST /compare-urls` defaults `maxRatio` to `1`, so the vision model always describes any difference it finds (rather than short-circuiting to an instant pixel-fail when two different pages diverge a lot). Identical pages still pass instantly via the pixel fast-path.

## API reference

### `POST /compare`

Request:

```json
{
  "name": "homepage",
  "baselinePng": "<base64 PNG>",
  "currentPng": "<base64 PNG>",
  "pixelThreshold": 0.001,
  "maxRatio": 0.5,
  "ignoreRegions": [{ "x": 0, "y": 0, "width": 200, "height": 40 }],
  "context": "header clock is dynamic"
}
```

Response:

```json
{
  "verdict": "pass",
  "decidedBy": "pixel-pass",
  "needsReview": false,
  "pixel": { "diffPixels": 0, "totalPixels": 60480, "diffRatio": 0, "width": 360, "height": 168, "sizeMismatch": false },
  "ai": null,
  "diffPng": "<base64 PNG>",
  "name": "homepage"
}
```

`decidedBy` is one of `pixel-pass`, `pixel-fail`, `ai`, or `ai-error`.

### `POST /compare-urls`

The server loads the URLs in a headless browser and compares them. Provide either a single pair or many:

```json
{
  "baselineUrl": "https://prod.example.com",
  "currentUrl": "https://staging.example.com",

  "pairs": [
    { "name": "home", "baselineUrl": "https://a", "currentUrl": "https://b", "context": "header clock is dynamic" }
  ],

  "breakpoints": [{ "name": "mobile", "width": 390, "height": 844 }],
  "fullPage": true,
  "waitUntil": "networkidle",
  "waitMs": 400,
  "headless": true,
  "userAgent": "Mozilla/5.0 ... Chrome/148.0.0.0 Safari/537.36",
  "locale": "en-US",
  "headers": { "Cookie": "session=..." },
  "pixelThreshold": 0.001,
  "maxRatio": 1,
  "context": "hints applied to every pair"
}
```

Response: a `summary`, the absolute paths of the written `reportHtml` / `reportMd`, and a `results[]` array (one entry per pair x breakpoint) with `verdict`, `decidedBy`, `diffRatio`, `ai`, and relative `images` paths. Failed captures appear as `verdict: "error"` rather than aborting the whole batch.

### `GET /health`

Returns LM Studio reachability and the list of available models.

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | OpenAI-compatible base URL (keep the `/v1`) |
| `LMSTUDIO_MODEL` | `qwen/qwen3-vl-4b` | Vision model identifier |
| `LMSTUDIO_API_TOKEN` | _(empty)_ | Bearer token if you enabled auth in LM Studio |
| `PORT` | `3100` | Comparison server port |
| `PIXEL_THRESHOLD` | `0.001` | `diffRatio` at/below which it passes instantly |
| `MAX_RATIO` | `0.5` | `diffRatio` at/above which it fails instantly |
| `PIXEL_MATCH_THRESHOLD` | `0.1` | pixelmatch per-pixel sensitivity (lower = stricter) |
| `WARM_MODEL_ON_START` | `false` | Load the model via LM Studio's native API on startup |
| `COMPARE_SERVER_URL` | `http://localhost:3100` | Client: where to send comparisons |
| `UPDATE_BASELINES` | _(empty)_ | Client: `1` to (re)write baselines |

## Project layout

```
src/server/
  index.ts              Express bootstrap
  config.ts             zod-validated env config
  types.ts              request/response/verdict types
  routes/compare.ts     POST /compare
  routes/health.ts      GET /health
  services/pixelDiff.ts sharp normalize + pixelmatch + diff PNG
  services/lmstudio.ts  OpenAI SDK -> LM Studio vision triage (structured output)
  services/verdict.ts   hybrid pass/fail logic
client/
  visualMatch.ts        Playwright helper (expectVisualMatch)
  baseline.ts           baseline read/write + UPDATE_BASELINES
scripts/smoke.ts        standalone smoke test
examples/               runnable Playwright demo
```
