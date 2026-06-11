# LM Studio Visual Regression Pipeline

A visual regression testing pipeline for Playwright, backed by a vision model served either locally by [LM Studio](https://lmstudio.ai/docs/developer/rest) or remotely via [OpenRouter](https://openrouter.ai) (`LLM_PROVIDER=openrouter`).

> **New here? Start with the [Quickstart](./QUICKSTART.md)** — it walks through installing LM Studio (macOS/Windows), downloading the Gemma-4-12B vision model, and running everything end to end. Prefer a hosted model? See [Using OpenRouter](#using-openrouter-hosted-models) below — no local model required.

It has two parts:

1. A stateless **comparison server** (Node/TypeScript + Express) that wraps the vision-model API and exposes `POST /compare`.
2. A **Playwright client helper** (`expectVisualMatch`) that captures screenshots, manages baselines, calls the server, and asserts the verdict — attaching the baseline, current, diff, and AI reasoning to the Playwright HTML report.

## How it decides pass/fail (hybrid)

```
diffRatio = changed pixels / total pixels   (computed with pixelmatch)

diffRatio <= PIXEL_THRESHOLD   ->  PASS instantly        (no model call)
diffRatio >= MAX_RATIO         ->  FAIL instantly        (no model call)
in between                     ->  vision model triages  (regression vs. noise)
```

The vision model receives the baseline, the current screenshot, the diff overlay, and the bounding boxes of the changed-pixel clusters (so it knows exactly where to look), then returns a structured JSON verdict (`regression`, `confidence`, `summary`, `changes[]`) via [structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output). If the model or provider does not support JSON-schema response formats, the server automatically falls back to `json_object` and then to lenient JSON parsing. This filters out acceptable noise (anti-aliasing, sub-pixel font hinting, dynamic timestamps) while catching real regressions (moved/missing elements, color/layout/text changes).

Oversized screenshots are downscaled (longest edge `AI_MAX_IMAGE_DIM`, default 2048px) before being sent to the model, so every provider sees a predictable, legible input instead of applying its own resampling.

If the model call fails (after `AI_RETRIES` transient retries), the comparison **fails closed** (`needsReview: true`) rather than silently passing. AI verdicts that come back with confidence below `AI_REVIEW_CONFIDENCE` are also flagged `needsReview: true`, so borderline calls get a human in the loop.

## Prerequisites

- Node.js 22.5+ (uses the built-in `node:sqlite` module for UI-saved settings; developed against Node 26).
- Either a local LM Studio server **or** an OpenRouter API key (see below).

### Option A: LM Studio (local, default)

- [LM Studio](https://lmstudio.ai) running locally with the server on (`lms server start`, default `http://localhost:1234`).
- A **vision-capable** model loaded. Small models (<7B) are unreliable for structured output, so prefer a capable VLM:

```bash
lms get qwen/qwen3-vl-4b      # or any vision model you prefer
lms server start
```

Any multimodal model that supports structured output works (e.g. `qwen/qwen3-vl-*`, `google/gemma-4-12b`). Set it via `LMSTUDIO_MODEL`.

### Option B: Using OpenRouter (hosted models)

Skip the local model entirely and run AI triage on any vision-capable model in the [OpenRouter catalog](https://openrouter.ai/models?modality=image-%3Etext):

```bash
# .env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...          # https://openrouter.ai/keys
OPENROUTER_MODEL=google/gemini-2.5-flash
```

Notes:

- Any vision-capable slug works, e.g. `google/gemini-2.5-flash` (fast/cheap), `anthropic/claude-sonnet-4.5` (highest accuracy), `qwen/qwen3-vl-235b-a22b-instruct`.
- The server tries JSON-schema structured output first and falls back automatically for models that don't support it.
- `GET /health` validates your API key and confirms the model slug exists in the catalog.
- `WARM_MODEL_ON_START` is ignored (there is nothing to load).
- Screenshots are uploaded to OpenRouter for analysis — keep `LLM_PROVIDER=lmstudio` if your UIs must not leave the machine.

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

# Verify it can reach the configured provider (LM Studio or OpenRouter):
curl http://localhost:3100/health
```

`GET /health` reports the active provider, whether it is reachable, the configured model, and whether the model is loaded (LM Studio) / available in the catalog with a valid key (OpenRouter).

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
  "pixel": { "diffPixels": 0, "totalPixels": 60480, "diffRatio": 0, "width": 360, "height": 168, "sizeMismatch": false, "diffRegions": [] },
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

Returns the active provider (`lmstudio` or `openrouter`), its reachability, the configured model, the list of available models, and which configuration layer is active (`source`: `database`, `env`, or `default`).

### Settings (`GET /settings`, `PUT /settings/llm`, `DELETE /settings/llm`)

The web UI's **Settings** page lets you pick the AI backend, enter an OpenRouter API key, and choose the model. Saved settings persist in a SQLite database (`data/settings.db`, created on first save) and survive restarts.

- `GET /settings` — the effective LLM settings, which layer they came from, and what each layer defines (the API key is only ever returned masked).
- `PUT /settings/llm` — save `{ provider, openrouterApiKey?, openrouterModel? }`. Omitted fields keep their current value, so you can switch models without re-entering the key.
- `DELETE /settings/llm` — clear saved settings, reverting to `.env` / defaults.
- `GET /settings/openrouter/models` — vision-capable models from the OpenRouter catalog (used for the model picker's autocomplete).

## Configuration (`.env`)

Settings are resolved in priority order:

1. **UI-saved settings** (`data/settings.db`) — anything saved from the Settings page wins.
2. **Environment / `.env`** — an explicit `LLM_PROVIDER` wins; otherwise defining `OPENROUTER_API_KEY` (or `OPENROUTER_MODEL`) selects OpenRouter.
3. **Default** — a locally running LM Studio model.

| Variable | Default | Description |
| --- | --- | --- |
| `LLM_PROVIDER` | `lmstudio` | AI backend: `lmstudio` (local) or `openrouter` (hosted) |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | OpenAI-compatible base URL (keep the `/v1`) |
| `LMSTUDIO_MODEL` | `qwen/qwen3-vl-4b` | Vision model identifier (LM Studio) |
| `LMSTUDIO_API_TOKEN` | _(empty)_ | Bearer token if you enabled auth in LM Studio |
| `OPENROUTER_API_KEY` | _(empty)_ | OpenRouter API key (required when `LLM_PROVIDER=openrouter`) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter API base URL |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` | Vision model slug (OpenRouter) |
| `PORT` | `3100` | Comparison server port |
| `PIXEL_THRESHOLD` | `0.001` | `diffRatio` at/below which it passes instantly |
| `MAX_RATIO` | `0.5` | `diffRatio` at/above which it fails instantly |
| `PIXEL_MATCH_THRESHOLD` | `0.1` | pixelmatch per-pixel sensitivity (lower = stricter) |
| `AI_MAX_IMAGE_DIM` | `2048` | Longest image edge sent to the model (`0` = no downscaling) |
| `AI_RETRIES` | `2` | Retries for transient model-call failures |
| `AI_REVIEW_CONFIDENCE` | `0.6` | AI verdicts below this confidence are flagged `needsReview` |
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
  services/pixelDiff.ts sharp normalize + pixelmatch + diff PNG + region clustering
  services/llm.ts       provider-agnostic client (LM Studio / OpenRouter) + JSON fallback + retries
  services/visionTriage.ts vision triage prompt + structured verdict
  services/verdict.ts   hybrid pass/fail logic
client/
  visualMatch.ts        Playwright helper (expectVisualMatch)
  baseline.ts           baseline read/write + UPDATE_BASELINES
scripts/smoke.ts        standalone smoke test
examples/               runnable Playwright demo
```
