/**
 * Self-contained word-level text diff, faithful to Python difflib's
 * SequenceMatcher.ratio() semantics: ratio = 2 * M / T where M is the number of
 * matched tokens (here via LCS) and T is the total token count of both sides.
 * No external dependency.
 */

export interface CompareResult {
  /** True when (1 - ratio) <= threshold. */
  pass: boolean;
  /** SequenceMatcher-style similarity ratio in [0, 1]. */
  ratio: number;
  /** True when there is any token-level difference. */
  changed: boolean;
  /** Words present in `current` but not matched in `baseline`. */
  added: string[];
  /** Words present in `baseline` but not matched in `current`. */
  removed: string[];
  /** Readable word-level unified diff (empty when identical). */
  diffText: string;
}

function tokenize(text: string): string[] {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

type Op = { tag: "equal" | "insert" | "delete"; value: string };

/**
 * Longest-common-subsequence DP over tokens. Returns the match count and the
 * sequence of edit ops (equal/delete/insert) reconstructed by backtracking.
 */
function lcsDiff(a: string[], b: string[]): { matches: number; ops: Op[] } {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        row[j] = next[j + 1]! + 1;
      } else {
        row[j] = Math.max(next[j]!, row[j + 1]!);
      }
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: "equal", value: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ tag: "delete", value: a[i]! });
      i++;
    } else {
      ops.push({ tag: "insert", value: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ tag: "delete", value: a[i++]! });
  while (j < m) ops.push({ tag: "insert", value: b[j++]! });

  return { matches: dp[0]![0]!, ops };
}

function renderDiff(ops: Op[]): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.tag === "delete") lines.push(`- ${op.value}`);
    else if (op.tag === "insert") lines.push(`+ ${op.value}`);
    else lines.push(`  ${op.value}`);
  }
  return lines.join("\n");
}

export function compareTexts(
  baseline: string,
  current: string,
  threshold = 0,
): CompareResult {
  const a = tokenize(baseline);
  const b = tokenize(current);
  const total = a.length + b.length;

  const { matches, ops } = lcsDiff(a, b);
  const ratio = total === 0 ? 1 : (2 * matches) / total;
  const changed = ops.some((op) => op.tag !== "equal");

  const added = ops.filter((op) => op.tag === "insert").map((op) => op.value);
  const removed = ops.filter((op) => op.tag === "delete").map((op) => op.value);

  return {
    pass: 1 - ratio <= threshold,
    ratio,
    changed,
    added,
    removed,
    diffText: changed ? renderDiff(ops) : "",
  };
}
