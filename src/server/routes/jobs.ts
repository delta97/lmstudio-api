import { Router } from "express";
import { compareUrlsRequestSchema } from "../types.js";
import {
  getJob,
  listJobs,
  startJob,
  subscribeToJob,
} from "../services/jobs.js";

/**
 * Job-based comparison API. Unlike GET /compare-urls/stream — where the run is
 * tied to one SSE connection — a job keeps running server-side regardless of
 * who is watching, several jobs can run at once, and clients can (re)attach to
 * a job's stream at any time and receive a full replay of its history.
 */
export const jobsRouter = Router();

jobsRouter.post("/jobs", (req, res) => {
  const parsed = compareUrlsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
    return;
  }
  res.status(202).json({ job: startJob(parsed.data) });
});

jobsRouter.get("/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

jobsRouter.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job });
});

/**
 * SSE attach. Replays the job's buffered events (so a late or reconnecting
 * client sees the complete history), then streams live events. Emits the same
 * named events as GET /compare-urls/stream plus "job:state", and ends after
 * the terminal "done"/"error" event.
 */
jobsRouter.get("/jobs/:id/stream", (req, res) => {
  const id = req.params.id;
  if (!getJob(id)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;

  const unsubscribe = subscribeToJob(id, ({ event, data }) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (event === "done" || event === "error") {
      closed = true;
      unsubscribe?.();
      res.end();
    }
  });

  req.on("close", () => {
    closed = true;
    unsubscribe?.();
  });
});
