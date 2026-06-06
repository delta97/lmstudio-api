import { promises as fs } from "node:fs";
import path from "node:path";

export interface AiChange {
  region: string;
  description: string;
  severity: string;
}

export interface BreakpointResult {
  name: string;
  width: number;
  height: number;
  verdict: "pass" | "fail";
  decidedBy: string;
  diffRatio: number;
  sizeMismatch: boolean;
  ai: { summary: string; confidence: number; changes: AiChange[] } | null;
  baselineImage: string; // relative path under the report dir
  currentImage: string;
  diffImage: string;
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function writeReport(
  reportDir: string,
  results: BreakpointResult[],
): Promise<{ htmlPath: string; mdPath: string }> {
  await fs.mkdir(reportDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const totalChanges = results.reduce(
    (n, r) => n + (r.ai?.changes.length ?? 0),
    0,
  );
  const failing = results.filter((r) => r.verdict === "fail").length;

  // ---- Markdown report ----
  const md: string[] = [];
  md.push(`# Responsive Visual Regression Report`);
  md.push("");
  md.push(`Generated: ${generatedAt}`);
  md.push("");
  md.push(
    `Breakpoints with differences: **${failing}/${results.length}** | Total changes flagged: **${totalChanges}**`,
  );
  md.push("");
  for (const r of results) {
    md.push(`## ${r.name} (${r.width}x${r.height})`);
    md.push("");
    md.push(
      `- Verdict: **${r.verdict.toUpperCase()}** (decided by ${r.decidedBy})`,
    );
    md.push(`- Pixel diff: ${(r.diffRatio * 100).toFixed(3)}%`);
    if (r.ai) {
      md.push(
        `- AI summary: ${r.ai.summary} (confidence ${r.ai.confidence})`,
      );
      if (r.ai.changes.length) {
        md.push(`- Changes:`);
        for (const c of [...r.ai.changes].sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity.toLowerCase()] ?? 9) -
            (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 9),
        )) {
          md.push(`  - [${c.severity}] ${c.region}: ${c.description}`);
        }
      }
    } else {
      md.push(`- No AI triage (decided by pixel logic).`);
    }
    md.push("");
  }
  const mdPath = path.join(reportDir, "report.md");
  await fs.writeFile(mdPath, md.join("\n"));

  // ---- HTML report ----
  const cards = results
    .map((r) => {
      const badge =
        r.verdict === "fail"
          ? `<span style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;">DIFFERENT</span>`
          : `<span style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;">MATCH</span>`;

      const changes =
        r.ai && r.ai.changes.length
          ? `<ul class="changes">${[...r.ai.changes]
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

      const summary = r.ai
        ? `<p class="summary">${escapeHtml(r.ai.summary)}</p>`
        : `<p class="muted">Decided by pixel logic (${r.decidedBy}).</p>`;

      return `
      <section class="card">
        <div class="card-head">
          <h2>${escapeHtml(r.name)} <span class="dims">${r.width}&times;${r.height}</span></h2>
          ${badge}
        </div>
        <div class="meta">Pixel diff ${(r.diffRatio * 100).toFixed(3)}% &middot; decided by ${escapeHtml(r.decidedBy)}</div>
        ${summary}
        ${changes}
        <div class="shots">
          <figure><figcaption>Baseline (v1)</figcaption><img src="${r.baselineImage}" /></figure>
          <figure><figcaption>Current (v2)</figcaption><img src="${r.currentImage}" /></figure>
          <figure><figcaption>Diff</figcaption><img src="${r.diffImage}" /></figure>
        </div>
      </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Responsive Visual Regression Report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:#0f172a; color:#e2e8f0; }
  header.top { padding:32px 24px; max-width:1100px; margin:0 auto; }
  header.top h1 { margin:0 0 6px; font-size:26px; }
  header.top .sub { color:#94a3b8; font-size:14px; }
  .summary-bar { display:flex; gap:16px; margin-top:16px; flex-wrap:wrap; }
  .pill { background:#1e293b; border:1px solid #334155; border-radius:10px; padding:10px 14px; font-size:14px; }
  .pill strong { font-size:18px; }
  main { max-width:1100px; margin:0 auto; padding:0 24px 48px; display:grid; gap:20px; }
  .card { background:#ffffff; color:#0f172a; border-radius:16px; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,.25); }
  .card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .card-head h2 { margin:0; font-size:20px; text-transform:capitalize; }
  .dims { font-size:13px; color:#64748b; font-weight:500; }
  .card-head span { padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.02em; }
  .meta { color:#64748b; font-size:13px; margin-top:6px; }
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
    <h1>Responsive Visual Regression Report</h1>
    <div class="sub">Nimbus landing page &middot; v1 (baseline) vs v2 (current) &middot; ${escapeHtml(
      generatedAt,
    )}</div>
    <div class="summary-bar">
      <div class="pill"><strong>${failing}</strong>/${results.length} breakpoints changed</div>
      <div class="pill"><strong>${totalChanges}</strong> changes flagged by the vision model</div>
    </div>
  </header>
  <main>
    ${cards}
  </main>
</body>
</html>`;

  const htmlPath = path.join(reportDir, "index.html");
  await fs.writeFile(htmlPath, html);

  return { htmlPath, mdPath };
}
