import { promises as fs } from "node:fs";
import path from "node:path";
import type { UrlComparisonItem } from "../types.js";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** "$0.0042" — enough precision for per-call vision-model spend. */
function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  return `$${usd.toFixed(usd >= 0.1 ? 2 : 4)}`;
}

function usageLine(it: UrlComparisonItem): string | null {
  const usage = it.ai?.usage;
  if (!usage) return null;
  const cost =
    typeof usage.costUsd === "number" ? ` (${formatUsd(usage.costUsd)})` : "";
  return `${usage.totalTokens.toLocaleString("en-US")} tokens${cost}`;
}

function severityColor(sev: string): string {
  switch (sev.toLowerCase()) {
    case "high":
      return "#dc2626";
    case "medium":
      return "#d97706";
    default:
      return "#2563eb";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function groupByPair(
  items: UrlComparisonItem[],
): { name: string; items: UrlComparisonItem[] }[] {
  const groups = new Map<string, UrlComparisonItem[]>();
  for (const it of items) {
    const arr = groups.get(it.name) ?? [];
    arr.push(it);
    groups.set(it.name, arr);
  }
  return [...groups.entries()].map(([name, its]) => ({ name, items: its }));
}

function badge(verdict: string): string {
  if (verdict === "error")
    return `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">ERROR</span>`;
  if (verdict === "fail")
    return `<span style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;">DIFFERENT</span>`;
  return `<span style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;">MATCH</span>`;
}

function renderItem(it: UrlComparisonItem): string {
  if (it.verdict === "error") {
    return `
    <section class="card">
      <div class="card-head">
        <h3>${escapeHtml(it.breakpoint)} <span class="dims">${it.width}&times;${it.height}</span></h3>
        ${badge(it.verdict)}
      </div>
      <p class="err">Capture failed: ${escapeHtml(it.error ?? "unknown error")}</p>
    </section>`;
  }

  const changes =
    it.ai && it.ai.changes.length
      ? `<ul class="changes">${[...it.ai.changes]
          .sort(
            (a, b) =>
              (SEVERITY_ORDER[a.severity.toLowerCase()] ?? 9) -
              (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 9),
          )
          .map(
            (c) =>
              `<li><span class="sev" style="background:${severityColor(
                c.severity,
              )}">${escapeHtml(c.severity)}</span><strong>${escapeHtml(
                c.region,
              )}</strong> &mdash; ${escapeHtml(c.description)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">No itemized changes.</p>`;

  const summary = it.ai
    ? `<p class="summary">${escapeHtml(it.ai.summary)}</p>`
    : `<p class="muted">Decided by pixel logic (${escapeHtml(it.decidedBy)}).</p>`;

  const shots = it.images
    ? `<div class="shots">
        <figure><figcaption>Baseline</figcaption><img src="${it.images.baseline}" /></figure>
        <figure><figcaption>Current</figcaption><img src="${it.images.current}" /></figure>
        <figure><figcaption>Diff</figcaption><img src="${it.images.diff}" /></figure>
      </div>`
    : "";

  const mismatch = it.sizeMismatch
    ? ` &middot; <span class="warn">size mismatch</span>`
    : "";

  const usage = usageLine(it);
  const usageHtml = usage ? ` &middot; AI usage ${escapeHtml(usage)}` : "";

  return `
    <section class="card">
      <div class="card-head">
        <h3>${escapeHtml(it.breakpoint)} <span class="dims">${it.width}&times;${it.height}</span></h3>
        ${badge(it.verdict)}
      </div>
      <div class="meta">Pixel diff ${(it.diffRatio * 100).toFixed(3)}% &middot; decided by ${escapeHtml(it.decidedBy)}${mismatch}${usageHtml}</div>
      ${summary}
      ${changes}
      ${shots}
    </section>`;
}

export async function saveReport(
  reportDir: string,
  items: UrlComparisonItem[],
): Promise<{ htmlPath: string; mdPath: string }> {
  await fs.mkdir(reportDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const groups = groupByPair(items);
  const different = items.filter((i) => i.verdict === "fail").length;
  const errors = items.filter((i) => i.verdict === "error").length;
  const totalChanges = items.reduce(
    (n, i) => n + (i.ai?.changes.length ?? 0),
    0,
  );
  const totalTokens = items.reduce(
    (n, i) => n + (i.ai?.usage?.totalTokens ?? 0),
    0,
  );
  const totalCost = items.reduce(
    (n, i) => n + (i.ai?.usage?.costUsd ?? 0),
    0,
  );
  const usageSummary =
    totalTokens > 0
      ? `${totalTokens.toLocaleString("en-US")} tokens (${formatUsd(totalCost)})`
      : null;

  // ---- Markdown ----
  const md: string[] = [
    `# URL Visual Comparison Report`,
    "",
    `Generated: ${generatedAt}`,
    "",
    `Comparisons: **${items.length}** | Different: **${different}** | Errors: **${errors}** | Changes flagged: **${totalChanges}**${usageSummary ? ` | AI usage: **${usageSummary}**` : ""}`,
    "",
  ];
  for (const g of groups) {
    const first = g.items[0];
    md.push(`## ${g.name}`);
    if (first) {
      md.push("");
      md.push(`- Baseline: ${first.baselineUrl}`);
      md.push(`- Current: ${first.currentUrl}`);
    }
    md.push("");
    for (const it of g.items) {
      md.push(`### ${it.breakpoint} (${it.width}x${it.height})`);
      if (it.verdict === "error") {
        md.push(`- ERROR: ${it.error ?? "unknown"}`);
        md.push("");
        continue;
      }
      md.push(`- Verdict: **${it.verdict.toUpperCase()}** (${it.decidedBy})`);
      md.push(`- Pixel diff: ${(it.diffRatio * 100).toFixed(3)}%`);
      if (it.sizeMismatch) md.push(`- Note: baseline/current dimensions differed`);
      if (it.ai) {
        md.push(`- AI: ${it.ai.summary} (confidence ${it.ai.confidence})`);
        const usage = usageLine(it);
        if (usage) md.push(`- AI usage: ${usage}`);
        for (const c of [...it.ai.changes].sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity.toLowerCase()] ?? 9) -
            (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 9),
        )) {
          md.push(`  - [${c.severity}] ${c.region}: ${c.description}`);
        }
      }
      md.push("");
    }
  }
  const mdPath = path.join(reportDir, "report.md");
  await fs.writeFile(mdPath, md.join("\n"));

  // ---- HTML ----
  const sections = groups
    .map((g) => {
      const first = g.items[0];
      const links = first
        ? `<div class="urls"><a href="${escapeHtml(
            first.baselineUrl,
          )}">${escapeHtml(first.baselineUrl)}</a> <span>vs</span> <a href="${escapeHtml(
            first.currentUrl,
          )}">${escapeHtml(first.currentUrl)}</a></div>`
        : "";
      return `
      <div class="group">
        <h2>${escapeHtml(g.name)}</h2>
        ${links}
        ${g.items.map(renderItem).join("\n")}
      </div>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>URL Visual Comparison Report</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:#0f172a; color:#e2e8f0; }
  header.top { padding:32px 24px; max-width:1100px; margin:0 auto; }
  header.top h1 { margin:0 0 6px; font-size:26px; }
  header.top .sub { color:#94a3b8; font-size:14px; }
  .summary-bar { display:flex; gap:12px; margin-top:16px; flex-wrap:wrap; }
  .pill { background:#1e293b; border:1px solid #334155; border-radius:10px; padding:10px 14px; font-size:14px; }
  .pill strong { font-size:18px; }
  main { max-width:1100px; margin:0 auto; padding:0 24px 48px; }
  .group { margin-bottom:36px; }
  .group h2 { font-size:20px; margin:0 0 4px; text-transform:capitalize; }
  .urls { font-size:13px; color:#94a3b8; margin-bottom:14px; word-break:break-all; }
  .urls a { color:#7dd3fc; text-decoration:none; }
  .urls span { color:#64748b; margin:0 6px; }
  .card { background:#ffffff; color:#0f172a; border-radius:16px; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,.25); margin-bottom:16px; }
  .card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .card-head h3 { margin:0; font-size:18px; text-transform:capitalize; }
  .dims { font-size:13px; color:#64748b; font-weight:500; }
  .card-head span { padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.02em; }
  .meta { color:#64748b; font-size:13px; margin-top:6px; }
  .warn { color:#b45309; font-weight:600; }
  .err { color:#b91c1c; font-weight:600; margin-top:10px; }
  .summary { margin:12px 0; font-size:15px; line-height:1.5; }
  .muted { color:#94a3b8; font-style:italic; }
  ul.changes { list-style:none; padding:0; margin:12px 0 0; display:grid; gap:8px; }
  ul.changes li { font-size:14px; line-height:1.45; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; }
  .sev { display:inline-block; color:#fff; font-size:11px; font-weight:700; text-transform:uppercase; padding:2px 7px; border-radius:6px; margin-right:8px; }
  .shots { margin-top:16px; display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .shots figure { margin:0; }
  .shots figcaption { font-size:12px; color:#64748b; margin-bottom:6px; font-weight:600; }
  .shots img { width:100%; border:1px solid #e2e8f0; border-radius:10px; display:block; background:#fff; }
  @media (max-width:720px){ .shots { grid-template-columns:1fr; } }
</style>
</head>
<body>
  <header class="top">
    <h1>URL Visual Comparison Report</h1>
    <div class="sub">Generated ${escapeHtml(generatedAt)}</div>
    <div class="summary-bar">
      <div class="pill"><strong>${items.length}</strong> comparisons</div>
      <div class="pill"><strong>${different}</strong> different</div>
      <div class="pill"><strong>${errors}</strong> errors</div>
      <div class="pill"><strong>${totalChanges}</strong> changes flagged</div>
      ${usageSummary ? `<div class="pill"><strong>${escapeHtml(usageSummary)}</strong> AI usage</div>` : ""}
    </div>
  </header>
  <main>
    ${sections}
  </main>
</body>
</html>`;

  const htmlPath = path.join(reportDir, "index.html");
  await fs.writeFile(htmlPath, html);

  return { htmlPath, mdPath };
}
