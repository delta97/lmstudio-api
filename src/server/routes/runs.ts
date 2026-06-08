import { Router } from "express";
import { isSafeRunId, listRuns, readRun } from "../services/runStore.js";

export const runsRouter = Router();

runsRouter.get("/runs", async (_req, res) => {
  const runs = await listRuns();
  res.json({ runs });
});

runsRouter.get("/runs/:id", async (req, res) => {
  const { id } = req.params;
  if (!isSafeRunId(id)) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const run = await readRun(id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});
