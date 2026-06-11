import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite-backed persistence for settings edited in the UI.
 *
 * Settings saved here take priority over the environment (.env): the resolver
 * in llmConfig.ts checks this store first, then the environment, and finally
 * falls back to a locally running LM Studio model.
 *
 * Uses the Node built-in `node:sqlite` driver (Node >= 22.5), so there is no
 * native-module dependency. The database lives at data/settings.db and is
 * created on first use.
 */

export const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "settings.db");

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  return db;
}

const KEYS = {
  provider: "llm_provider",
  openrouterApiKey: "openrouter_api_key",
  openrouterModel: "openrouter_model",
} as const;

export interface StoredLlmSettings {
  provider?: "lmstudio" | "openrouter";
  openrouterApiKey?: string;
  openrouterModel?: string;
}

function readKey(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Settings previously saved from the UI, or null when nothing was saved. */
export function readStoredLlmSettings(): StoredLlmSettings | null {
  const provider = readKey(KEYS.provider);
  const openrouterApiKey = readKey(KEYS.openrouterApiKey);
  const openrouterModel = readKey(KEYS.openrouterModel);
  if (!provider && !openrouterApiKey && !openrouterModel) return null;
  return {
    ...(provider === "lmstudio" || provider === "openrouter"
      ? { provider }
      : {}),
    ...(openrouterApiKey ? { openrouterApiKey } : {}),
    ...(openrouterModel ? { openrouterModel } : {}),
  };
}

/**
 * Persists the given fields. Fields that are undefined/empty are left
 * untouched, so the API key does not have to be re-entered to change models.
 */
export function saveLlmSettings(patch: StoredLlmSettings): void {
  const upsert = getDb().prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE
       SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  if (patch.provider) upsert.run(KEYS.provider, patch.provider);
  if (patch.openrouterApiKey)
    upsert.run(KEYS.openrouterApiKey, patch.openrouterApiKey);
  if (patch.openrouterModel)
    upsert.run(KEYS.openrouterModel, patch.openrouterModel);
}

/** Removes all saved LLM settings, reverting resolution to .env / defaults. */
export function clearLlmSettings(): void {
  getDb()
    .prepare("DELETE FROM settings WHERE key IN (?, ?, ?)")
    .run(KEYS.provider, KEYS.openrouterApiKey, KEYS.openrouterModel);
}
