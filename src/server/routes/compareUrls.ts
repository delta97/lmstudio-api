import { promises as fs } from "node:fs";
import path from "node:path";
import { Router } from "express";
import {
  compareUrlsRequestSchema,
  type CompareUrlsResponse,
  type UrlComparisonItem,
} from "../types.js";
import { compareUrls } from "../services/urlCompare.js";
import { saveReport } from "../services/report.js";

export const compareUrlsRouter = Router();

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
}

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

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportDir = path.join(process.cwd(), "reports", stamp);
    const imagesDir = path.join(reportDir, "images");
    await fs.mkdir(imagesDir, { recursive: true });

    const items: UrlComparisonItem[] = [];
    let index = 0;
    for (const r of raw) {
      const item: UrlComparisonItem = { ...r.item };
      if (r.baseline && r.current && r.diff) {
        const prefix = `${sanitize(item.name)}-${sanitize(item.breakpoint)}-${index}`;
        const baseRel = path.join("images", `${prefix}-baseline.png`);
        const curRel = path.join("images", `${prefix}-current.png`);
        const diffRel = path.join("images", `${prefix}-diff.png`);
        await fs.writeFile(path.join(reportDir, baseRel), r.baseline);
        await fs.writeFile(path.join(reportDir, curRel), r.current);
        await fs.writeFile(path.join(reportDir, diffRel), r.diff);
        item.images = { baseline: baseRel, current: curRel, diff: diffRel };
      }
      items.push(item);
      index++;
    }

    const { htmlPath, mdPath } = await saveReport(reportDir, items);

    const response: CompareUrlsResponse = {
      reportDir,
      reportHtml: htmlPath,
      reportMd: mdPath,
      summary: {
        comparisons: items.length,
        different: items.filter((i) => i.verdict === "fail").length,
        errors: items.filter((i) => i.verdict === "error").length,
        changesFlagged: items.reduce(
          (n, i) => n + (i.ai?.changes.length ?? 0),
          0,
        ),
      },
      results: items,
    };

    res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "URL comparison failed", message });
  }
});
