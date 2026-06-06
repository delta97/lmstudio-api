import express from "express";
import { config } from "./config.js";
import { compareRouter } from "./routes/compare.js";
import { compareUrlsRouter } from "./routes/compareUrls.js";
import { healthRouter } from "./routes/health.js";
import { warmModel } from "./services/lmstudio.js";

const app = express();

// Screenshots are sent as base64 PNGs, which can be large.
app.use(express.json({ limit: "50mb" }));

app.use(healthRouter);
app.use(compareRouter);
app.use(compareUrlsRouter);

app.get("/", (_req, res) => {
  res.json({
    name: "lmstudio-visual-regression",
    endpoints: ["GET /health", "POST /compare", "POST /compare-urls"],
    lmStudio: config.lmStudio.baseUrl,
    model: config.lmStudio.model,
  });
});

async function start(): Promise<void> {
  if (config.warmModelOnStart) {
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
    console.log(`  LM Studio: ${config.lmStudio.baseUrl}`);
    console.log(`  Model:     ${config.lmStudio.model}`);
    console.log(
      `  Thresholds: pass<=${config.diff.pixelThreshold}, fail>=${config.diff.maxRatio}`,
    );
  });
}

void start();
