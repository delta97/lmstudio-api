import { chromium, type Browser } from "@playwright/test";

export interface Breakpoint {
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

// A realistic desktop Chrome UA. Playwright's default headless UA contains
// "HeadlessChrome", which trips many bot walls (e.g. CloudFront/Akamai).
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export interface CaptureOptions {
  fullPage: boolean;
  waitUntil: WaitUntil;
  waitMs: number;
  timeoutMs: number;
  headless: boolean;
  userAgent?: string;
  locale: string;
  headers?: Record<string, string>;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  fullPage: true,
  waitUntil: "networkidle",
  waitMs: 400,
  timeoutMs: 45_000,
  headless: true,
  userAgent: DEFAULT_USER_AGENT,
  locale: "en-US",
};

// Freeze transitions/animations and hide carets so screenshots are deterministic.
const FREEZE_CSS = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}`;

export async function withBrowser<T>(
  options: { headless: boolean },
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({
    headless: options.headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function captureUrl(
  browser: Browser,
  url: string,
  breakpoint: Breakpoint,
  options: CaptureOptions,
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: breakpoint.width, height: breakpoint.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    userAgent: options.userAgent,
    locale: options.locale,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      ...options.headers,
    },
  });
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: options.waitUntil,
      timeout: options.timeoutMs,
    });
    await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {
      /* style injection is best-effort */
    });
    if (options.waitMs > 0) {
      await page.waitForTimeout(options.waitMs);
    }
    return await page.screenshot({ fullPage: options.fullPage });
  } finally {
    await context.close();
  }
}
