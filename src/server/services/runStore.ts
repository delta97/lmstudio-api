import { promises as fs } from "node:fs";
import path from "node:path";
import type { CompareUrlsResponse, UrlComparisonItem } from "../types.js";
import { saveReport } from "./report.js";
import type { RawComparison } from "./urlCompare.js";

export const REPORTS_DIR = path.join(process.cwd(), "reports");

/** Full persisted run record (results.json). Image paths are root-relative. */
export interface StoredRun extends CompareUrlsResponse {
  id: string;
  generatedAt: string;
}

/** Lightweight run descriptor for the History list. */
export interface RunListItem {
  id: string;
  generatedAt: string;
  summary: CompareUrlsResponse["summary"];
  pairs: { name: string; baselineUrl: string; currentUrl: string }[];
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
}

/** Rewrites report-relative image paths to root-relative URLs the SPA can load. */
function toSpaItem(item: UrlComparisonItem, runId: string): UrlComparisonItem {
  if (!item.images) return item;
  return {
    ...item,
    images: {
      baseline: `/reports/${runId}/${item.images.baseline}`,
      current: `/reports/${runId}/${item.images.current}`,
      diff: `/reports/${runId}/${item.images.diff}`,
    },
  };
}

function summarize(items: UrlComparisonItem[]): CompareUrlsResponse["summary"] {
  const withUsage = items.filter((i) => i.ai?.usage);
  return {
    comparisons: items.length,
    different: items.filter((i) => i.verdict === "fail").length,
    errors: items.filter((i) => i.verdict === "error").length,
    changesFlagged: items.reduce((n, i) => n + (i.ai?.changes.length ?? 0), 0),
    aiCalls: withUsage.length,
    totalTokens: withUsage.reduce(
      (n, i) => n + (i.ai?.usage?.totalTokens ?? 0),
      0,
    ),
    costUsd: withUsage.reduce((n, i) => n + (i.ai?.usage?.costUsd ?? 0), 0),
  };
}

function pairsFromItems(
  items: UrlComparisonItem[],
): { name: string; baselineUrl: string; currentUrl: string }[] {
  const seen = new Map<
    string,
    { name: string; baselineUrl: string; currentUrl: string }
  >();
  for (const it of items) {
    if (!seen.has(it.name)) {
      seen.set(it.name, {
        name: it.name,
        baselineUrl: it.baselineUrl,
        currentUrl: it.currentUrl,
      });
    }
  }
  return [...seen.values()];
}

export interface PersistedRun {
  runId: string;
  reportDir: string;
  /** Report-relative image paths; preserves the legacy POST contract. */
  response: CompareUrlsResponse;
  /** Root-relative image URLs for the SPA / SSE done event / results.json. */
  spaResponse: StoredRun;
}

/**
 * Writes images, the HTML/MD report, and results.json for a completed run.
 * The HTML report keeps report-relative image paths; results.json and the
 * SPA response use root-relative `/reports/<id>/images/...` URLs.
 */
export async function persistRun(raw: RawComparison[]): Promise<PersistedRun> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(REPORTS_DIR, runId);
  const imagesDir = path.join(reportDir, "images");
  await fs.mkdir(imagesDir, { recursive: true });

  const items: UrlComparisonItem[] = [];
  let index = 0;
  for (const r of raw) {
    const item: UrlComparisonItem = { ...r.item };
    if (r.baseline && r.current && r.diff) {
      const prefix = `${sanitize(item.name)}-${sanitize(item.breakpoint)}-${index}`;
      // Forward slashes so paths are valid both on disk and as URLs.
      const baseRel = `images/${prefix}-baseline.png`;
      const curRel = `images/${prefix}-current.png`;
      const diffRel = `images/${prefix}-diff.png`;
      await fs.writeFile(path.join(reportDir, baseRel), r.baseline);
      await fs.writeFile(path.join(reportDir, curRel), r.current);
      await fs.writeFile(path.join(reportDir, diffRel), r.diff);
      item.images = { baseline: baseRel, current: curRel, diff: diffRel };
    }
    items.push(item);
    index++;
  }

  const { htmlPath, mdPath } = await saveReport(reportDir, items);
  const summary = summarize(items);

  const response: CompareUrlsResponse = {
    reportDir,
    reportHtml: htmlPath,
    reportMd: mdPath,
    summary,
    results: items,
  };

  const spaResponse: StoredRun = {
    ...response,
    id: runId,
    generatedAt: new Date().toISOString(),
    results: items.map((it) => toSpaItem(it, runId)),
  };

  await fs.writeFile(
    path.join(reportDir, "results.json"),
    JSON.stringify(spaResponse, null, 2),
  );

  return { runId, reportDir, response, spaResponse };
}

/** Validates a run id to prevent path traversal. */
export function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/** Lists persisted runs (newest first) from reports/<id>/results.json. */
export async function listRuns(): Promise<RunListItem[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs: RunListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeRunId(entry.name)) continue;
    const run = await readRun(entry.name);
    if (!run) continue;
    runs.push({
      id: run.id,
      generatedAt: run.generatedAt,
      summary: run.summary,
      pairs: pairsFromItems(run.results),
    });
  }

  // ISO-ish timestamp ids sort lexically; newest first.
  runs.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return runs;
}

/** Reads a single run's results.json; returns null if missing/unreadable. */
export async function readRun(id: string): Promise<StoredRun | null> {
  if (!isSafeRunId(id)) return null;
  const file = path.join(REPORTS_DIR, id, "results.json");
  // Defense in depth: ensure the resolved file stays under REPORTS_DIR.
  if (!file.startsWith(REPORTS_DIR + path.sep)) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as StoredRun;
    // Backfill id/generatedAt for older records that lack them.
    if (!parsed.id) parsed.id = id;
    if (!parsed.generatedAt) parsed.generatedAt = id;
    return parsed;
  } catch {
    return null;
  }
}
