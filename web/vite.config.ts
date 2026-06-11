import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Backend Express server (see src/server) runs on :3100.
const BACKEND = "http://localhost:3100";

// Paths that must be forwarded to the backend during development.
// `/compare-urls/stream` is Server-Sent Events: it must NOT be buffered or
// compressed, so we keep changeOrigin on and let the proxy pass the raw stream
// through (no ws upgrade needed for SSE — it's plain HTTP).
const proxyPaths = [
  "/health",
  "/compare-urls",
  "/jobs",
  "/runs",
  "/reports",
  "/compare",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: Object.fromEntries(
      proxyPaths.map((p) => [
        p,
        {
          target: BACKEND,
          changeOrigin: true,
          // Disable websocket upgrades; SSE is plain HTTP streaming.
          ws: false,
        },
      ]),
    ),
  },
});
