import { test } from "@playwright/test";
import { expectVisualMatch } from "../../client/visualMatch.js";

/**
 * A deterministic local page rendered with setContent so the demo runs offline.
 * Set INTRODUCE_REGRESSION=1 to mutate the UI and trigger the comparison.
 */
function pageHtml(): string {
  const regression = process.env.INTRODUCE_REGRESSION === "1";
  const buttonColor = regression ? "#c0392b" : "#2d7d46";
  const buttonLabel = regression ? "Buy now!!!" : "Add to cart";
  const heading = regression ? "Welcome  back" : "Welcome back";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, Helvetica, Arial, sans-serif;
        background: #f4f5f7;
        color: #1f2933;
      }
      .card {
        width: 360px;
        margin: 60px auto;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        padding: 28px;
      }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 20px; color: #52606d; }
      button {
        width: 100%;
        padding: 12px 16px;
        border: none;
        border-radius: 8px;
        color: #fff;
        font-size: 15px;
        font-weight: 600;
        background: ${buttonColor};
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${heading}</h1>
      <p>Your cart is ready when you are.</p>
      <button>${buttonLabel}</button>
    </div>
  </body>
</html>`;
}

test("checkout card matches baseline", async ({ page }) => {
  await page.setContent(pageHtml());
  await page.waitForLoadState("networkidle");

  await expectVisualMatch(page, "checkout-card", {
    target: page.locator(".card"),
    context:
      "Static marketing card. The heading, body text, button color and label are all expected to remain stable.",
  });
});
