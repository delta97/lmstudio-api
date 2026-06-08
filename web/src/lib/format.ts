/** Small formatting helpers shared across screens. */

/** Formats a 0..1 diff ratio as a percentage string, e.g. 0.0123 -> "1.23%". */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  if (pct === 0) return "0%";
  if (pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

/** Formats a 0..1 confidence as a whole-number percentage, e.g. "82%". */
export function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return "—";
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Run ids are ISO timestamps with `:`/`.` replaced by `-`
 * (e.g. "2026-06-06T19-30-12-345Z"). Prefer the explicit `generatedAt` ISO
 * string when present; fall back to reconstructing from the id.
 */
export function parseRunDate(generatedAt?: string, id?: string): Date | null {
  if (generatedAt) {
    const d = new Date(generatedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (id) {
    // Re-insert the ISO separators: YYYY-MM-DDТHH-MM-SS-mmmZ -> ...T HH:MM:SS.mmm Z
    const iso = id.replace(
      /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
      "$1T$2:$3:$4.$5Z",
    );
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Human-friendly absolute timestamp, e.g. "Jun 6, 2026, 12:30 PM". */
export function formatTimestamp(generatedAt?: string, id?: string): string {
  const date = parseRunDate(generatedAt, id);
  if (!date) return id ?? "unknown";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Relative time, e.g. "3 minutes ago". Falls back to absolute on failure. */
export function formatRelative(generatedAt?: string, id?: string): string {
  const date = parseRunDate(generatedAt, id);
  if (!date) return id ?? "unknown";
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return formatTimestamp(generatedAt, id);
}

/** Formats elapsed milliseconds as mm:ss (or h:mm:ss past an hour). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}
