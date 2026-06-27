import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Drives the persistent OCR worker (ocr-worker/ocr_server.py) as a lazy
 * singleton child process. The worker loads the Unlimited-OCR model once and
 * OCRs many images over a JSON-lines stdin/stdout protocol, so we never pay the
 * model-load cost per screenshot.
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

function ocrDir(): string {
  const fromEnv = process.env.OCR_WORKER_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(repoRoot, "ocr-worker");
}

function ocrPython(dir: string): string {
  return process.env.OCR_WORKER_PYTHON ?? path.join(dir, ".venv/bin/python");
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

interface WorkerResponse {
  id?: string;
  ready?: boolean;
  ok?: boolean;
  text?: string;
  error?: string;
}

let worker: ChildProcessWithoutNullStreams | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 0;
const pending = new Map<string, PendingRequest>();
let stdoutBuffer = "";

function missingDepsError(dir: string, python: string): Error {
  return new Error(
    `OCR worker not found.\n` +
      `  expected dir:    ${dir}\n` +
      `  expected python: ${python}\n` +
      `Create the worker venv (cd ocr-worker && python3.10 -m venv .venv && ` +
      `.venv/bin/pip install -r requirements.txt), or set OCR_WORKER_DIR / ` +
      `OCR_WORKER_PYTHON to point at an existing worker dir and interpreter.`,
  );
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg: WorkerResponse;
  try {
    msg = JSON.parse(trimmed) as WorkerResponse;
  } catch {
    // Non-JSON noise on stdout; surface it on stderr for debugging.
    process.stderr.write(`[ocrEngine] non-JSON stdout line: ${trimmed}\n`);
    return;
  }

  if (msg.ready) return; // readiness is awaited separately

  if (msg.id == null) return;
  const req = pending.get(msg.id);
  if (!req) return;
  pending.delete(msg.id);

  if (msg.ok && typeof msg.text === "string") {
    req.resolve(msg.text);
  } else {
    req.reject(new Error(msg.error ?? "OCR worker returned an error"));
  }
}

function rejectAll(err: Error): void {
  for (const req of pending.values()) req.reject(err);
  pending.clear();
}

async function ensureWorker(): Promise<ChildProcessWithoutNullStreams> {
  if (worker && readyPromise) {
    await readyPromise;
    return worker;
  }

  const dir = ocrDir();
  const python = ocrPython(dir);
  const serverScript = path.join(dir, "ocr_server.py");

  if (!existsSync(dir) || !existsSync(python) || !existsSync(serverScript)) {
    throw missingDepsError(dir, python);
  }

  const child = spawn(python, ["ocr_server.py"], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  worker = child;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let idx: number;
    while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      handleLine(line);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    process.stderr.write(`[ocr_server] ${chunk}`);
  });

  readyPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const onReadyLine = (chunk: string) => {
      if (settled) return;
      // Resolve as soon as we observe the {"ready": true} line in the stream.
      if (chunk.includes('"ready"')) {
        settled = true;
        resolve();
      }
    };
    child.stdout.on("data", onReadyLine);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on("exit", (code) => {
      const err = new Error(`OCR worker exited (code ${code}) before ready`);
      if (!settled) {
        settled = true;
        reject(err);
      }
      rejectAll(err);
      worker = null;
      readyPromise = null;
    });
  });

  await readyPromise;
  return child;
}

async function request(imagePath: string): Promise<string> {
  const child = await ensureWorker();
  const id = String(nextId++);
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(
      JSON.stringify({ id, image: path.resolve(imagePath) }) + "\n",
      (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      },
    );
  });
}

/** OCR an image file on disk, returning the worker's raw markdown output. */
export async function ocrImageFile(imagePath: string): Promise<string> {
  return request(imagePath);
}

/** OCR an in-memory PNG buffer by writing it to a temp file first. */
export async function ocrImageBuffer(buf: Buffer): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-buf-"));
  const tmpFile = path.join(tmpDir, "image.png");
  try {
    await fs.writeFile(tmpFile, buf);
    return await request(tmpFile);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/** Terminate the worker child process, if running. */
export async function shutdownOcr(): Promise<void> {
  const child = worker;
  if (!child) return;
  worker = null;
  readyPromise = null;
  rejectAll(new Error("OCR worker shut down"));
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.stdin.end();
    // Hard stop if it doesn't exit on EOF promptly.
    const timer = setTimeout(() => child.kill("SIGTERM"), 2000);
    child.once("exit", () => clearTimeout(timer));
  });
}
