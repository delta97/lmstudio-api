import { Router } from "express";
import { compareRequestSchema } from "../types.js";
import { compare } from "../services/verdict.js";

export const compareRouter = Router();

compareRouter.post("/compare", async (req, res) => {
  const parsed = compareRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await compare(parsed.data);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Comparison failed", message });
  }
});
