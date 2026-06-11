import { Router } from "express";
import { checkHealth } from "../services/llm.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const llm = await checkHealth();
  res.status(llm.reachable ? 200 : 503).json({
    status: llm.reachable ? "ok" : "degraded",
    provider: llm.provider,
    llm,
    // Kept for backward compatibility with existing clients; mirrors the
    // active provider's health regardless of which backend is configured.
    lmStudio: llm,
  });
});
