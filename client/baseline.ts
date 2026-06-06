import { promises as fs } from "node:fs";
import path from "node:path";

/** Returns true when the helper should (re)write baselines instead of asserting. */
export function isUpdateMode(): boolean {
  const v = process.env.UPDATE_BASELINES;
  return v === "1" || v?.toLowerCase() === "true";
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "_");
}

export function baselinePath(baselineDir: string, name: string): string {
  return path.join(baselineDir, `${sanitize(name)}.png`);
}

export async function readBaseline(
  baselineDir: string,
  name: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(baselinePath(baselineDir, name));
  } catch {
    return null;
  }
}

export async function writeBaseline(
  baselineDir: string,
  name: string,
  png: Buffer,
): Promise<string> {
  await fs.mkdir(baselineDir, { recursive: true });
  const file = baselinePath(baselineDir, name);
  await fs.writeFile(file, png);
  return file;
}
