import { promises as fs } from "node:fs";

/**
 * CLI for the /compare-urls endpoint.
 *
 * Two URLs:
 *   npm run compare-urls -- https://baseline.example.com https://current.example.com
 *
 * With options:
 *   npm run compare-urls -- <baselineUrl> <currentUrl> --name home --no-full-page
 *
 * From a JSON request body (array of pairs, custom breakpoints, etc.):
 *   npm run compare-urls -- --config ./pairs.json
 *
 * Env: COMPARE_SERVER_URL (default http://localhost:3100)
 */

const SERVER = process.env.COMPARE_SERVER_URL ?? "http://localhost:3100";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function buildBody(args: string[]): Promise<Record<string, unknown>> {
  const configPath = getFlag(args, "config");
  if (configPath) {
    return JSON.parse(await fs.readFile(configPath, "utf8"));
  }

  const positional = args.filter((a) => !a.startsWith("--"));
  // Drop values consumed by flags that take an argument.
  const flagValues = new Set(
    [
      "name",
      "config",
      "server",
      "bp",
      "wait-until",
      "wait-ms",
      "max-ratio",
      "user-agent",
    ]
      .map((f) => getFlag(args, f))
      .filter(Boolean) as string[],
  );
  const urls = positional.filter((p) => !flagValues.has(p));

  const [baselineUrl, currentUrl] = urls;
  if (!baselineUrl || !currentUrl) {
    throw new Error(
      "Provide two URLs (baseline current) or --config <file.json>.",
    );
  }

  const body: Record<string, unknown> = { baselineUrl, currentUrl };
  const name = getFlag(args, "name");
  if (name) body.pairs = [{ name, baselineUrl, currentUrl }];
  if (args.includes("--no-full-page")) body.fullPage = false;
  const bp = getFlag(args, "bp");
  if (bp) {
    const presets: Record<string, { name: string; width: number; height: number }> = {
      mobile: { name: "mobile", width: 390, height: 844 },
      tablet: { name: "tablet", width: 768, height: 1024 },
      desktop: { name: "desktop", width: 1440, height: 900 },
    };
    body.breakpoints = bp
      .split(",")
      .map((b) => presets[b.trim()])
      .filter(Boolean);
  }
  const waitUntil = getFlag(args, "wait-until");
  if (waitUntil) body.waitUntil = waitUntil;
  const waitMs = getFlag(args, "wait-ms");
  if (waitMs) body.waitMs = Number(waitMs);
  const maxRatio = getFlag(args, "max-ratio");
  if (maxRatio) body.maxRatio = Number(maxRatio);
  if (args.includes("--headed")) body.headless = false;
  const userAgent = getFlag(args, "user-agent");
  if (userAgent) body.userAgent = userAgent;

  return body;
}

async function main() {
  const args = process.argv.slice(2);
  const body = await buildBody(args);

  console.log(`POST ${SERVER}/compare-urls`);
  const res = await fetch(`${SERVER}/compare-urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Server error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    reportHtml: string;
    reportMd: string;
    summary: {
      comparisons: number;
      different: number;
      errors: number;
      changesFlagged: number;
    };
    results: {
      name: string;
      breakpoint: string;
      verdict: string;
      diffRatio: number;
      ai: { summary: string } | null;
      error?: string;
    }[];
  };

  console.log("");
  for (const r of data.results) {
    const head = `[${r.name} / ${r.breakpoint}] ${r.verdict.toUpperCase()} (${(
      r.diffRatio * 100
    ).toFixed(2)}%)`;
    console.log(head);
    if (r.error) console.log(`   error: ${r.error}`);
    else if (r.ai) console.log(`   ${r.ai.summary}`);
  }
  console.log("");
  console.log(
    `Summary: ${data.summary.comparisons} comparisons, ${data.summary.different} different, ` +
      `${data.summary.errors} errors, ${data.summary.changesFlagged} changes flagged.`,
  );
  console.log(`Report: ${data.reportHtml}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
