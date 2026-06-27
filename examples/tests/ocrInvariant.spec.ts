import { test } from "@playwright/test";
import { expectOcrInvariant } from "../../client/ocrInvariant.js";

/**
 * Demonstrates the OCR content-invariance check: the same text content rendered
 * two different ways. Pixel diffing would flag the restyle as a regression;
 * expectOcrInvariant is blind to it because the *content* is unchanged.
 *
 * Set RESTYLE=1 to render the restyled (but content-identical) variant.
 * Set INTRODUCE_REGRESSION=1 to drop a word and trigger a real content failure.
 */
function pageHtml(): string {
  const restyle = process.env.RESTYLE === "1";
  const regression = process.env.INTRODUCE_REGRESSION === "1";

  const body = regression
    ? "Your cart is ready."
    : "Your cart is ready when you are.";

  const style = restyle
    ? `body { font-family: Georgia, serif; background: #101820; color: #f2f2f2; }
       .card { width: 480px; margin: 40px auto; padding: 40px; text-align: center; }
       h1 { font-size: 34px; letter-spacing: 2px; }`
    : `body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #f4f5f7; color: #1f2933; }
       .card { width: 360px; margin: 60px auto; padding: 28px; }
       h1 { font-size: 22px; }`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; }
      ${style}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Welcome back</h1>
      <p>${body}</p>
      <button>Add to cart</button>
    </div>
  </body>
</html>`;
}

test("checkout card content survives restyle", async ({ page }) => {
  await page.setContent(pageHtml());
  await page.waitForLoadState("networkidle");

  await expectOcrInvariant(page, "checkout-card-content", {
    target: page.locator(".card"),
  });
});
