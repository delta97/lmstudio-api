import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { compareRouter } from "./routes/compare.js";
import { compareUrlsRouter } from "./routes/compareUrls.js";
import { healthRouter } from "./routes/health.js";
import { jobsRouter } from "./routes/jobs.js";
import { runsRouter } from "./routes/runs.js";
import { settingsRouter } from "./routes/settings.js";
import { getProviderLabel, warmModel } from "./services/llm.js";
import { getLlmConfig } from "./services/llmConfig.js";
import { REPORTS_DIR } from "./services/runStore.js";

const app = express();

// Permissive CORS for local dev so a Vite dev server on another port can call
// these endpoints directly even when not proxied.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Screenshots are sent as base64 PNGs, which can be large.
app.use(express.json({ limit: "50mb" }));

// Serve persisted report images (baseline/current/diff PNGs) to the SPA.
app.use("/reports", express.static(REPORTS_DIR));

app.use(healthRouter);
app.use(compareRouter);
app.use(compareUrlsRouter);
app.use(jobsRouter);
app.use(runsRouter);
app.use(settingsRouter);

app.get("/", (_req, res) => {
  const llm = getLlmConfig();
  res.json({
    name: "lmstudio-visual-regression",
    endpoints: [
      "GET /health",
      "POST /compare",
      "POST /compare-urls",
      "GET /compare-urls/stream",
      "POST /jobs",
      "GET /jobs",
      "GET /jobs/:id",
      "GET /jobs/:id/stream",
      "GET /runs",
      "GET /runs/:id",
      "GET /reports/<id>/...",
      "GET /settings",
      "PUT /settings/llm",
      "DELETE /settings/llm",
      "GET /settings/openrouter/models",
    ],
    provider: llm.provider,
    llmBaseUrl: llm.baseUrl,
    model: llm.model,
    settingsSource: llm.source,
  });
});

async function start(): Promise<void> {
  const llm = getLlmConfig();

  if (llm.provider === "openrouter" && !llm.apiKey) {
    console.warn(
      "OpenRouter is the active provider but no API key is configured — model calls will fail until one is saved in Settings or set via OPENROUTER_API_KEY.",
    );
  }

  if (config.warmModelOnStart && llm.provider === "lmstudio") {
    try {
      console.log(`Warming model "${config.lmStudio.model}"...`);
      await warmModel();
      console.log("Model loaded.");
    } catch (err) {
      console.warn(
        `Could not warm model: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  app.listen(config.server.port, () => {
    console.log(
      `Visual regression server listening on http://localhost:${config.server.port}`,
    );
    console.log(
      `  Provider:  ${getProviderLabel()} (${llm.baseUrl}) [from ${llm.source}]`,
    );
    console.log(`  Model:     ${llm.model}`);
    console.log(
      `  Thresholds: pass<=${config.diff.pixelThreshold}, fail>=${config.diff.maxRatio}`,
    );
  });
}

void start();
