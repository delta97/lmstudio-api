import { Router } from "express";
import { checkHealth } from "../services/lmstudio.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const lmStudio = await checkHealth();
  res.status(lmStudio.reachable ? 200 : 503).json({
    status: lmStudio.reachable ? "ok" : "degraded",
    lmStudio,
  });
});
