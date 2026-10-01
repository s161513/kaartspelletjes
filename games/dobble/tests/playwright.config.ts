import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".", testMatch: "browser.spec.ts", timeout: 120000, workers: 1,
  use: { baseURL: "http://127.0.0.1:4317", channel: "msedge", trace: "retain-on-failure" },
  outputDir: fileURLToPath(new URL("../test-results", import.meta.url)),
  webServer: { command: "node server/dist/index.js", cwd: fileURLToPath(new URL("../../../", import.meta.url)), env: { PORT: "4317" }, url: "http://127.0.0.1:4317/health", reuseExistingServer: false, timeout: 30000 },
});
