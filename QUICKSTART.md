# Quickstart

Get the whole LM Studio visual regression pipeline running from zero on **macOS** or **Windows**.

There are three things to set up:

1. **LM Studio** (the local AI server) + the **Gemma-4-12B** vision model.
2. **Node.js** (to run the comparison server and Playwright).
3. **This project** (install deps, start the server, run a comparison).

---

## 1. Install LM Studio

LM Studio is a free desktop app that runs models locally and exposes an OpenAI-compatible API.

### macOS

- Requires an Apple Silicon Mac (M1 or newer) and macOS 13+.
- Download the `.dmg` from <https://lmstudio.ai/download> (or `brew install --cask lm-studio`).
- Open the `.dmg`, drag **LM Studio** to Applications, and launch it.

### Windows

- Requires a 64-bit CPU with AVX2 (most CPUs from the last ~10 years). A GPU with 8 GB+ VRAM is strongly recommended for the 12B model.
- Download the installer from <https://lmstudio.ai/download> (or `winget install ElementLabs.LMStudio`).
- Run the installer and launch **LM Studio**.

---

## 2. Download the Gemma-4-12B vision model

The 12B model needs roughly **8 GB of free RAM/VRAM** at a 4-bit quant. If you have less, pick a smaller vision model (e.g. `google/gemma-4-e4b`) and set it as `LMSTUDIO_MODEL` later.

### Option A: In the LM Studio app (easiest)

1. Click the **Search / Discover** (magnifying glass) tab.
2. Search for **`gemma 4 12b`**.
3. Pick the **vision-capable** variant (look for an image/eye icon — it must be multimodal). Choose a **Q4_K_M** quant for a good size/quality balance.
4. Click **Download** and wait for it to finish.

### Option B: From the terminal (lms CLI)

The `lms` CLI ships with LM Studio. If `lms` isn't on your PATH yet, install it once:

```bash
npx lmstudio install-cli
```

Then download the model:

```bash
lms get google/gemma-4-12b
```

> Tip: run `lms ls` to see everything you've downloaded, and the exact model identifier to use for `LMSTUDIO_MODEL`.

---

## 3. Start the LM Studio server

### Option A: In the app

1. Go to the **Developer** tab (the `>_` icon on the left).
2. Toggle the server **On** (top-left). It listens on `http://localhost:1234`.
3. Load the Gemma model from the model selector at the top so it's ready to serve.

### Option B: From the terminal

```bash
lms server start          # starts the API on http://localhost:1234
lms load google/gemma-4-12b   # load the model into memory
lms ps                    # confirm it's loaded
```

Verify it's up:

```bash
curl http://localhost:1234/v1/models
```

You should see `google/gemma-4-12b` (or whatever you downloaded) in the list.

---

## 4. Install Node.js

Check if you already have it:

```bash
node --version    # need v18 or newer
```

If not:

- **macOS:** `brew install node` (or download the LTS installer from <https://nodejs.org>).
- **Windows:** `winget install OpenJS.NodeJS.LTS` (or the installer from <https://nodejs.org>).

---

## 5. Set up this project

From the project folder (`lmstudio-api`):

```bash
npm install
cp .env.example .env
```

Edit `.env` and set the model to the one you downloaded:

```bash
LMSTUDIO_MODEL=google/gemma-4-12b
```

If you'll run the example tests or compare live URLs, install the browser once:

```bash
npx playwright install chromium
```

---

## 6. Start the comparison server

```bash
npm start
```

You should see `Visual regression server listening on http://localhost:3100`.

Check it can reach LM Studio (in another terminal):

```bash
curl http://localhost:3100/health
```

`reachable: true` and `modelLoaded: true` means you're ready.

---

## 7. Run something

Pick whichever fits your goal (each needs the server from step 6 running):

**Smoke test (no browser needed):**

```bash
npm run smoke
```

**Compare two live URLs and get a report:**

```bash
npm run compare-urls -- https://example.com https://example.com/about
# open the printed report path, e.g. reports/<timestamp>/index.html
```

**Responsive breakpoint demo (mobile/tablet/desktop):**

```bash
npm run test:responsive
# then open examples/report/index.html
```

**Use it inside your own Playwright tests:** see the `expectVisualMatch` section in the [README](./README.md).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `curl localhost:1234/v1/models` fails | LM Studio server isn't running — toggle it on (Developer tab) or `lms server start`. |
| `/health` shows `modelLoaded: false` | Load the model in LM Studio, or make sure `LMSTUDIO_MODEL` exactly matches an entry from `lms ls`. |
| AI verdict is empty / `decidedBy: "ai-error"` | The model may not support vision or structured output. Use a multimodal model (Gemma-4-12B vision) and a Q4+ quant. |
| `Cannot POST /compare-urls` | The comparison server is running old code — stop it and `npm start` again. |
| Comparing real URLs returns a 403 / challenge page | The site blocks bots. Try `--headed`, a custom `--user-agent`, or pass a session cookie via a `--config` JSON. See the "Bot protection" section in the README. |
| `node: command not found` | Install Node.js (step 4) and reopen your terminal. |
| 12B model is too slow / won't load | Use a smaller vision model (e.g. `google/gemma-4-e4b`) and set it as `LMSTUDIO_MODEL`. |
