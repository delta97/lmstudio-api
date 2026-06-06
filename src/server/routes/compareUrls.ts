import { Router } from "express";
import { compareUrlsRequestSchema } from "../types.js";
import { compareUrls } from "../services/urlCompare.js";
import { persistRun } from "../services/runStore.js";

export const compareUrlsRouter = Router();

compareUrlsRouter.post("/compare-urls", async (req, res) => {
  const parsed = compareUrlsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const raw = await compareUrls(parsed.data);
    const { response } = await persistRun(raw);
    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "URL comparison failed", message });
  }
});

/** Parses the `config` query param as JSON, accepting raw JSON or base64-JSON. */
function parseConfigParam(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Fall back to base64-encoded JSON.
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  }
}

/**
 * SSE variant of POST /compare-urls.
 * EventSource only does GET, so the request is passed as a JSON-encoded
 * `?config=` query param (raw urlencoded JSON or base64-encoded JSON).
 * Streams `run:start`, `cell:start`, `cell:stage`, `cell:done`, `cell:error`,
 * and `summary:update` events, then a final `done` event with the full
 * CompareUrlsResponse, before ending the response.
 */
compareUrlsRouter.get("/compare-urls/stream", async (req, res) => {
  const rawConfig = req.query.config;
  if (typeof rawConfig !== "string") {
    res
      .status(400)
      .json({ error: "Missing `config` query param (JSON-encoded request)." });
    return;
  }

  let configJson: unknown;
  try {
    configJson = parseConfigParam(rawConfig);
  } catch {
    res
      .status(400)
      .json({ error: "Invalid `config` query param: could not parse JSON." });
    return;
  }

  const parsed = compareUrlsRequestSchema.safeParse(configJson);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request config",
      details: parsed.error.flatten(),
    });
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
  req.on("close", () => {
    closed = true;
  });

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const raw = await compareUrls(parsed.data, (event) => {
      send(event.type, event);
    });
    if (closed) return;

    const { spaResponse } = await persistRun(raw);
    send("done", spaResponse);
    res.end();
  } catch (err) {
    if (closed) return;
    const message = err instanceof Error ? err.message : String(err);
    send("error", { error: "URL comparison failed", message });
    res.end();
  }
});
