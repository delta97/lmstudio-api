# Visual Regression Video — Design

**Date:** 2026-06-05
**Goal:** Produce a ~60s 1080p video, rendered with Remotion, that shows the LM Studio
visual-regression pipeline "in action" comparing `modernize.com` (baseline) against
`modernize.com/pros` (current) for visual parity.

## Source of truth

The video dramatizes a **real run that already exists** in
`reports/2026-06-06T02-51-35-843Z/`. It does NOT require LM Studio to be running or the
sites to be re-scraped. The committed report supplies:

- 9 full-page PNGs (baseline/current/diff × mobile/tablet/desktop).
- Real pixel-diff ratios: mobile 48.94%, tablet 43.88%, desktop 41.25%.
- Real AI verdicts (all FAIL) + the flagged `changes[]` lists (10 total).

These are parsed into `remotion/data.ts` so on-screen text reflects actual results.

## Format

- 1920×1080, 30fps, ~1800 frames (~60s). Output: `out/visual-regression.mp4`.
- Theme: **dark technical dashboard**. Background `#0B0E14`, mono labels, accent teal
  `#2DD4BF` for scan/AI, amber→red ramp for diff severity. Screenshots in subtle device frames.

## Storyboard

1. **Title** (0–4s): "LM Studio Visual Regression" + `modernize.com → modernize.com/pros`.
2. **Setup** (4–7s): Baseline/Current URL chips animate in; "3 breakpoints · pixel-diff + AI triage".
3. **Per breakpoint** mobile → tablet → desktop (~15s each):
   - *Capture*: two device frames; tall real screenshots auto-scroll top→bottom under a scanline.
   - *Pixel diff*: current cross-fades to the diff heatmap; counter ticks to the real ratio; bar amber→red.
   - *AI triage*: "Triaging with vision model…" spinner, then the real AI summary types out; FAIL stamp.
   - *Flagged changes*: real `changes[]` stagger in as severity-tagged pills.
4. **Summary** (last ~6s): "3 / 3 FAIL · 10 changes · 0 errors" tally counts up; outro.

## Component architecture (Remotion)

- `remotion/index.ts` → registers root via `registerRoot`.
- `remotion/Root.tsx` → `<Composition>` for `VisualRegression` (1920×1080, 30fps, durationInFrames).
- `remotion/VisualRegression.tsx` → top sequence stitching the scenes with `<Sequence>`.
- `remotion/data.ts` → typed, parsed real data (urls, summary tallies, per-breakpoint records).
- `remotion/theme.ts` → colors, fonts, spacing tokens.
- `remotion/components/`:
  - `TitleCard.tsx`, `SetupCard.tsx`
  - `BreakpointSection.tsx` — orchestrates capture → diff → AI → changes for one breakpoint.
  - `DeviceFrame.tsx` — frame holding a screenshot that scrolls; supports diff cross-fade.
  - `DiffMeter.tsx` — animated ratio counter + severity bar.
  - `AICallout.tsx` — typewriter for the AI summary + FAIL stamp.
  - `ChangePills.tsx` — staggered severity-tagged change pills.
  - `SummaryCard.tsx` — final tally.
  - shared helpers: `Scanline.tsx`, `URLChip.tsx`.

## Assets

The 9 PNGs are copied into `remotion/public/` (served via `staticFile()`), renamed to stable
keys: `{bp}-{baseline|current|diff}.png` for bp in mobile/tablet/desktop.

## Build / render

- `npm run video:preview` → `remotion studio` (interactive).
- `npm run video:render` → `remotion render VisualRegression out/visual-regression.mp4`.

## Out of scope (YAGNI)

- Live re-scraping or live LM Studio calls.
- Audio/voiceover.
- Configurable URL pairs — this video is purpose-built for the modernize pair.
