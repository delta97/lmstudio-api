import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  analyzeImage,
  DEFAULT_ANALYSIS_MODEL,
  type ImageAnalysis,
} from "../src/analysis/attachmentVision.js";

/**
 * Analyze the image/video attachments referenced by an exported iMessage JSON
 * file using a vision model in LM Studio (defaults to gemma).
 *
 * Usage:
 *   npm run analyze-attachments -- [inputJson] [--out DIR] [--model ID] [--limit N] [--force]
 *
 * Defaults:
 *   inputJson = ~/Desktop/jaiden_hart_messages_last_10_days.json
 *   --out     = analysis-output
 *   --model   = $ANALYZE_MODEL or google/gemma-4-12b
 *
 * Images (jpeg/png/gif/webp/heic) are normalized to JPEG via sharp.
 * Videos (mp4/mov/...) have a single frame extracted via ffmpeg, then analyzed.
 * The run is resumable: already-analyzed attachments are skipped unless --force.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_INPUT = path.join(
  os.homedir(),
  "Desktop",
  "jaiden_hart_messages_last_10_days.json",
);
const MAX_DIM = 1024; // downscale longest edge before sending to the model

interface Attachment {
  filename: string | null;
  mime_type: string | null;
  path: string | null;
  exists: boolean;
  size_bytes?: number | null;
}

interface Message {
  timestamp: string;
  date: string;
  time: string;
  sender: string;
  handle: string;
  is_reaction?: boolean;
  text: string;
  attachments?: Attachment[];
}

interface ExportFile {
  contact?: string;
  messages: Message[];
}

interface ResultRecord {
  timestamp: string;
  sender: string;
  message_text: string;
  filename: string | null;
  path: string | null;
  mime_type: string | null;
  kind: "image" | "video" | "skipped";
  status: "analyzed" | "skipped" | "error";
  reason?: string;
  analysis?: ImageAnalysis;
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function classify(mime: string | null): "image" | "video" | "other" {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "other";
}

/** Normalize an image file to a downscaled JPEG buffer. */
async function imageToJpeg(filePath: string): Promise<Buffer> {
  return sharp(filePath, { animated: false })
    .rotate() // honor EXIF orientation
    .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Extract a single representative frame from a video into a JPEG buffer. */
async function videoToJpeg(filePath: string): Promise<Buffer> {
  const tmp = path.join(
    os.tmpdir(),
    `attach-frame-${process.pid}-${Date.now()}.jpg`,
  );
  try {
    // Seek ~0.5s in (skip black intro frames); grab one frame.
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      "0.5",
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      tmp,
    ]);
    const normalized = await imageToJpeg(tmp);
    return normalized;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function recordKey(r: { path: string | null; timestamp: string }): string {
  return `${r.timestamp}::${r.path ?? ""}`;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildMarkdown(contact: string, model: string, results: ResultRecord[]): string {
  const analyzed = results.filter((r) => r.status === "analyzed");
  const lines: string[] = [];
  lines.push(`# Attachment analysis — ${contact}`);
  lines.push("");
  lines.push(`- Model: \`${model}\``);
  lines.push(`- Attachments analyzed: ${analyzed.length}`);
  lines.push(`- Skipped: ${results.filter((r) => r.status === "skipped").length}`);
  lines.push(`- Errors: ${results.filter((r) => r.status === "error").length}`);
  lines.push("");
  for (const r of results) {
    const title = r.filename ?? "(no file)";
    lines.push(`## ${r.timestamp} — ${r.sender} — ${title}`);
    lines.push("");
    lines.push(`- Type: ${r.mime_type ?? "unknown"} (${r.kind})`);
    if (r.message_text) lines.push(`- Message text: ${escapeMd(r.message_text)}`);
    if (r.status !== "analyzed") {
      lines.push(`- Status: **${r.status}**${r.reason ? ` — ${r.reason}` : ""}`);
      lines.push("");
      continue;
    }
    const a = r.analysis!;
    lines.push(`- Summary: ${a.summary}`);
    lines.push(`- Category: ${a.content_category} | Setting: ${a.setting} | People: ${a.people_count}`);
    lines.push(`- Tags: ${a.tags.join(", ")}`);
    if (a.contains_text && a.text_content) {
      lines.push(`- Text in image: ${escapeMd(a.text_content)}`);
    }
    lines.push("");
    lines.push(a.description);
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Positional input path = first non-flag arg that isn't the value of a value-taking flag.
  const valueFlags = new Set(["out", "model", "limit"]);
  const positional = args.find((a, i) => {
    if (a.startsWith("--")) return false;
    const prev = args[i - 1];
    if (prev?.startsWith("--") && valueFlags.has(prev.slice(2))) return false;
    return true;
  });
  const inputPath = positional ?? DEFAULT_INPUT;
  const outDir = getFlag(args, "out") ?? "analysis-output";
  const model = getFlag(args, "model") ?? DEFAULT_ANALYSIS_MODEL;
  const limitRaw = getFlag(args, "limit");
  const limit = limitRaw ? Number(limitRaw) : Infinity;
  const force = hasFlag(args, "force");

  if (!existsSync(inputPath)) {
    throw new Error(`Input JSON not found: ${inputPath}`);
  }

  const raw = await fs.readFile(inputPath, "utf8");
  const data = JSON.parse(raw) as ExportFile;
  const contact = data.contact ?? "unknown";

  // Collect every attachment that has a usable file on disk.
  const pending: Array<{ message: Message; attachment: Attachment }> = [];
  for (const message of data.messages) {
    for (const attachment of message.attachments ?? []) {
      pending.push({ message, attachment });
    }
  }

  await fs.mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "analysis.json");
  const reportPath = path.join(outDir, "report.md");

  // Resume: load prior results, keyed by timestamp+path.
  const byKey = new Map<string, ResultRecord>();
  if (!force && existsSync(manifestPath)) {
    try {
      const prior = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        results?: ResultRecord[];
      };
      for (const r of prior.results ?? []) {
        if (r.status === "analyzed") byKey.set(recordKey(r), r);
      }
      console.log(`Resuming: ${byKey.size} attachment(s) already analyzed.`);
    } catch {
      console.warn("Could not read existing manifest; starting fresh.");
    }
  }

  const results: ResultRecord[] = [];
  let analyzedThisRun = 0;

  const persist = async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          contact,
          model,
          input: inputPath,
          generated_at: new Date().toISOString(),
          counts: {
            total: results.length,
            analyzed: results.filter((r) => r.status === "analyzed").length,
            skipped: results.filter((r) => r.status === "skipped").length,
            error: results.filter((r) => r.status === "error").length,
          },
          results,
        },
        null,
        2,
      ),
    );
    await fs.writeFile(reportPath, buildMarkdown(contact, model, results));
  };

  for (const { message, attachment } of pending) {
    const base: Omit<ResultRecord, "kind" | "status"> = {
      timestamp: message.timestamp,
      sender: message.sender,
      message_text: message.text,
      filename: attachment.filename,
      path: attachment.path,
      mime_type: attachment.mime_type,
    };

    const kindRaw = classify(attachment.mime_type);

    // Skip non-media or missing files.
    if (!attachment.exists || !attachment.path || kindRaw === "other") {
      results.push({
        ...base,
        kind: "skipped",
        status: "skipped",
        reason: !attachment.exists
          ? "no file on disk (link preview / plugin payload)"
          : `unsupported type: ${attachment.mime_type ?? "unknown"}`,
      });
      continue;
    }

    const kind = kindRaw; // "image" | "video"
    const cached = byKey.get(recordKey(base));
    if (cached) {
      results.push(cached);
      continue;
    }

    if (analyzedThisRun >= limit) {
      results.push({
        ...base,
        kind,
        status: "skipped",
        reason: "limit reached for this run",
      });
      continue;
    }

    const label = `${message.timestamp} ${attachment.filename ?? ""}`.trim();
    process.stdout.write(`Analyzing [${kind}] ${label} ... `);
    try {
      const jpeg =
        kind === "video"
          ? await videoToJpeg(attachment.path)
          : await imageToJpeg(attachment.path);
      const context = [
        `Sent by ${message.sender} on ${message.timestamp}.`,
        message.text ? `Accompanying message: "${message.text}"` : null,
        kind === "video" ? "This is a single frame from a video." : null,
      ]
        .filter(Boolean)
        .join(" ");
      const analysis = await analyzeImage(jpeg, "image/jpeg", { model, context });
      results.push({ ...base, kind, status: "analyzed", analysis });
      analyzedThisRun += 1;
      console.log(`ok — ${analysis.summary}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      results.push({ ...base, kind, status: "error", reason });
      console.log(`ERROR — ${reason}`);
    }

    await persist(); // checkpoint after each attachment for resumability
  }

  await persist();

  const analyzed = results.filter((r) => r.status === "analyzed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errored = results.filter((r) => r.status === "error").length;
  console.log(
    `\nDone. analyzed=${analyzed} skipped=${skipped} errors=${errored}`,
  );
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Report:   ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
