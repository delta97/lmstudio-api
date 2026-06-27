/**
 * Normalizes Unlimited-OCR markdown output down to comparable text content,
 * stripping styling/structural artifacts so a content diff is blind to the
 * cosmetic differences that pixel diffing flags.
 */

export interface NormalizeOptions {
  /** Lowercase the result. Default false. */
  lowercase?: boolean;
  /** Strip punctuation. Default false (threshold 0 is exact-after-structural). */
  stripPunctuation?: boolean;
}

export function normalizeOcrText(
  md: string,
  options: NormalizeOptions = {},
): string {
  let text = md;

  // Image placeholders: ![alt](images/..)
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");

  // Unlimited-OCR detection/box tokens: <|det|> ... [x, y, w, h] etc.
  text = text.replace(/<\|[^|]*\|>/g, " ");
  text = text.replace(/\[\s*\d[\d.,\s]*\]/g, " ");

  // Markdown table pipes and separator rows (---|---).
  text = text.replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, " ");
  text = text.replace(/\|/g, " ");

  // Heading markers and blockquotes at line start.
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");

  // Emphasis / inline-code markers (do not touch the words between them).
  text = text.replace(/[*_`~]/g, "");

  // Link syntax [text](url) -> text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  if (options.stripPunctuation) {
    text = text.replace(/[^\p{L}\p{N}\s]/gu, " ");
  }

  // Collapse all whitespace runs (incl. newlines) to single spaces.
  text = text.replace(/\s+/g, " ").trim();

  if (options.lowercase) {
    text = text.toLowerCase();
  }

  return text;
}
