// Real data parsed from the committed reports under reports/.
// Each RunData drives one video composition. Do not invent values here.

export type Severity = "high" | "medium" | "low";

export interface Change {
  severity: Severity;
  area: string;
  detail: string;
}

export interface Breakpoint {
  id: "mobile" | "tablet" | "desktop";
  label: string;
  width: number;
  height: number;
  // Native pixel dimensions of the captured PNGs (used for scroll math).
  shot: { w: number; baselineH: number; currentH: number; diffH: number };
  diffRatio: number; // 0..1
  aiSummary: string;
  changes: Change[];
}

export interface RunData {
  id: string; // composition id
  dir: string; // public/ subfolder holding {bp}-{baseline|current|diff}.png
  baselineUrl: string;
  currentUrl: string;
  shortLabel: string; // header chip, e.g. "modernize.com → /pros"
  titleLine: string;
  generated: string;
  summary: { comparisons: number; different: number; errors: number; changesFlagged: number };
  breakpoints: Breakpoint[];
}

// ── Run 1: modernize.com vs modernize.com/pros ──────────────────────────────
export const modernizePros: RunData = {
  id: "modernize-pros",
  dir: "modernize-pros",
  baselineUrl: "modernize.com",
  currentUrl: "modernize.com/pros",
  shortLabel: "modernize.com → /pros",
  titleLine: "Checking visual parity",
  generated: "2026-06-06T02:51:35Z",
  summary: { comparisons: 3, different: 3, errors: 0, changesFlagged: 10 },
  breakpoints: [
    {
      id: "mobile",
      label: "Mobile",
      width: 390,
      height: 844,
      shot: { w: 390, baselineH: 9562, currentH: 8496, diffH: 9562 },
      diffRatio: 0.48938,
      aiSummary:
        "The current version shows significant layout and content changes at the mobile breakpoint. The 'Pros' section is missing entirely from the current view, and several sections (How many more, Why We Provide, Settle for Nothing) are rearranged or different. The diff map highlights extensive structural changes.",
      changes: [
        {
          severity: "high",
          area: "Main Content Area",
          detail:
            "Content is completely different — baseline shows a landing page with multiple sections; current shows a 'Pros' section with different text, images, and layout.",
        },
        {
          severity: "high",
          area: "Content Sections",
          detail:
            "Different content sections and missing elements — the 'Pros' section is entirely absent from the current view.",
        },
        {
          severity: "low",
          area: "Header / Navigation",
          detail: "The header remains consistent across both versions.",
        },
      ],
    },
    {
      id: "tablet",
      label: "Tablet",
      width: 768,
      height: 1024,
      shot: { w: 768, baselineH: 9232, currentH: 7963, diffH: 9232 },
      diffRatio: 0.43881,
      aiSummary:
        "Significant layout and content changes at the tablet breakpoint. The 'Marketing Solutions' headline changed ('marketing + products' vs 'Marketing Solutions to Find & More') with a different sub-headline. The 'Customer Case Studies' section is missing, and the 'Modernize by the Numbers' figures are much larger, shifting the layout below.",
      changes: [
        {
          severity: "high",
          area: "Marketing Solutions",
          detail:
            "Headline changed from 'Marketing Solutions to Find & More' to 'marketing + products'; sub-headline significantly altered.",
        },
        {
          severity: "high",
          area: "Marketing Solutions",
          detail: "The 'Customer Case Studies' section is missing in the current version.",
        },
        {
          severity: "medium",
          area: "Modernize by the Numbers",
          detail:
            "Font size of the numbers (41M, 1000+, 17M, 382000) and surrounding text is significantly larger.",
        },
        {
          severity: "low",
          area: "Footer Area",
          detail: "Significant changes in font size and spacing between items.",
        },
      ],
    },
    {
      id: "desktop",
      label: "Desktop",
      width: 1440,
      height: 900,
      shot: { w: 1440, baselineH: 7713, currentH: 6299, diffH: 7713 },
      diffRatio: 0.41253,
      aiSummary:
        "Significant layout and content changes. The 'Fueling Growth for 800+ Home Service Businesses Nationwide' section is missing from the current image, replaced by a different 'marketplace solutions' section. The '360 finance' section differs significantly in layout and content, alongside other modified or removed sections.",
      changes: [
        {
          severity: "high",
          area: "Fueling Growth (800+ businesses)",
          detail: "This section is missing entirely from the current image.",
        },
        {
          severity: "high",
          area: "360 finance",
          detail: "Layout and content are significantly different in the current image.",
        },
        {
          severity: "medium",
          area: "Marketing Solutions",
          detail: "This section is missing from the current image.",
        },
      ],
    },
  ],
};

// ── Run 2: modernize.com/decks vs modernize.com/hvac ────────────────────────
export const decksHvac: RunData = {
  id: "decks-hvac",
  dir: "decks-hvac",
  baselineUrl: "modernize.com/decks",
  currentUrl: "modernize.com/hvac",
  shortLabel: "/decks → /hvac",
  titleLine: "Checking visual parity",
  generated: "2026-06-06T03:39:16Z",
  summary: { comparisons: 3, different: 3, errors: 0, changesFlagged: 7 },
  breakpoints: [
    {
      id: "mobile",
      label: "Mobile",
      width: 390,
      height: 844,
      shot: { w: 390, baselineH: 21558, currentH: 13212, diffH: 21558 },
      diffRatio: 0.23655,
      aiSummary:
        "Significant layout and content differences at the mobile breakpoint. The 'HVAC' content in the current view replaces the 'Decks' content from the baseline. The diff map highlights extensive changes across the entire screen because almost all text and elements have changed due to the different page content.",
      changes: [
        {
          severity: "high",
          area: "Header / Hero",
          detail: "The hero image and headline change from 'Decks' related content to 'HVAC' related content.",
        },
        {
          severity: "high",
          area: "Content Body",
          detail:
            "The entire body of the page is replaced with different text, images, and layout elements specific to HVAC services.",
        },
        {
          severity: "medium",
          area: "Navigation / Footer",
          detail: "Navigation links and footer content are updated to reflect the current page's theme.",
        },
      ],
    },
    {
      id: "tablet",
      label: "Tablet",
      width: 768,
      height: 1024,
      shot: { w: 768, baselineH: 17345, currentH: 10294, diffH: 17345 },
      diffRatio: 0.25194,
      aiSummary:
        "Significant layout and content changes at the tablet breakpoint. The section header and the content within it (images, text descriptions, and pricing tables) differ between the Decks baseline and the HVAC current. The entire bottom half of the design is fundamentally different.",
      changes: [
        {
          severity: "high",
          area: "Header",
          detail: "The page title in the content area below the navigation bar is replaced.",
        },
        {
          severity: "high",
          area: "Content Body",
          detail:
            "The main image and text descriptions are replaced; the layout, images, and pricing tables are different.",
        },
      ],
    },
    {
      id: "desktop",
      label: "Desktop",
      width: 1440,
      height: 900,
      shot: { w: 1440, baselineH: 16394, currentH: 9604, diffH: 16394 },
      diffRatio: 0.24239,
      aiSummary:
        "The current page displays different content than the baseline. The headline 'Deck Building & Maintenance Guide' is replaced by 'HVAC Repair and Replacement Guide', and the primary image shows an HVAC system instead of a deck. The entire body text is replaced. The layout remains consistent, but the content is completely different.",
      changes: [
        {
          severity: "high",
          area: "Header",
          detail:
            "The headline and primary image differ significantly between baseline (Decks) and current (HVAC).",
        },
        {
          severity: "high",
          area: "Content Body",
          detail: "The entire body content is replaced with HVAC-related information instead of deck-related information.",
        },
      ],
    },
  ],
};

export const runs: RunData[] = [modernizePros, decksHvac];
