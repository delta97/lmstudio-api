import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    // Deterministic rendering for stable screenshots.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },
});
