/**
 * Status vocabulary (data, types, helpers) shared across screens: cell stages,
 * verdicts, decided-by tags, and AI-change severities. Kept separate from the
 * badge components in components/status.tsx so each file has a single concern
 * (and Fast Refresh stays happy).
 *
 * Severity / verdict accents are the one place we reach past the neutral
 * semantic tokens: success (emerald) and warning (amber) have no token in this
 * theme, so they're encoded here once. The app is forced-dark, so no dark:
 * variants are needed.
 */

import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ScanSearchIcon,
  SparklesIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { AiChange, CellStage, UrlComparisonItem } from "@/lib/types";

// ---- Cell stages (live run) ----

export const STAGE_SEQUENCE: CellStage[] = [
  "capturing-baseline",
  "capturing-current",
  "pixel-diffing",
  "ai-reviewing",
];

interface StageMeta {
  label: string;
  Icon: LucideIcon;
}

export const STAGE_META: Record<CellStage, StageMeta> = {
  "capturing-baseline": { label: "Capturing baseline", Icon: CameraIcon },
  "capturing-current": { label: "Capturing current", Icon: CameraIcon },
  "pixel-diffing": { label: "Pixel diffing", Icon: ScanSearchIcon },
  "ai-reviewing": { label: "AI reviewing", Icon: SparklesIcon },
};

/**
 * The visible lifecycle of a single (pair x breakpoint) cell on the Live Run
 * grid: it sits queued, moves through stages, then resolves to a verdict or an
 * error.
 */
export type CellPhase =
  | { kind: "queued" }
  | { kind: "stage"; stage: CellStage }
  | { kind: "done"; verdict: UrlComparisonItem["verdict"] }
  | { kind: "error" };

export const StageIcons = {
  queued: CircleDashedIcon,
} as const;

// ---- Verdicts ----

export type VerdictValue = UrlComparisonItem["verdict"];

interface VerdictMeta {
  label: string;
  Icon: LucideIcon;
  /** Accent text colour. */
  text: string;
  /** Accent border + tinted background for outline badges/cards. */
  chip: string;
  /** A faint accent ring for cards. */
  ring: string;
}

export const VERDICT_META: Record<VerdictValue, VerdictMeta> = {
  pass: {
    label: "Match",
    Icon: CheckCircle2Icon,
    text: "text-emerald-400",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    ring: "ring-emerald-500/20",
  },
  fail: {
    label: "Different",
    Icon: AlertTriangleIcon,
    text: "text-amber-400",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    ring: "ring-amber-500/25",
  },
  error: {
    label: "Error",
    Icon: XCircleIcon,
    text: "text-destructive",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
    ring: "ring-destructive/25",
  },
};

// ---- Decided-by ----

export const DECIDED_BY_LABEL: Record<string, string> = {
  "pixel-pass": "pixel · pass",
  "pixel-fail": "pixel · fail",
  ai: "ai vision",
  "ai-error": "ai · error",
  error: "capture error",
};

// ---- AI change severity ----

export type Severity = AiChange["severity"];

export const SEVERITY_RANK: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface SeverityMeta {
  label: string;
  chip: string;
  dot: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  high: {
    label: "High",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  medium: {
    label: "Medium",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    dot: "bg-amber-400",
  },
  low: {
    label: "Low",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    dot: "bg-sky-400",
  },
};

/** Sorts AI changes high → low severity (stable for equal severities). */
export function sortChangesBySeverity(changes: AiChange[]): AiChange[] {
  return [...changes].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}
