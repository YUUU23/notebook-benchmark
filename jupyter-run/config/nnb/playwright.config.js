/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
import { defineConfig } from "playwright/test";
const baseConfig = require("@jupyterlab/galata/lib/playwright-config");
module.exports = {
  ...baseConfig,
  ...defineConfig({
    testDir: "../../ui",
    testMatch: "autotest.spec.ts", // Matches only this file
    // Realworld notebooks (heavy training/plots) run far longer than Galata's
    // 60s default per-test timeout, which was silently failing them. 20 min
    // covers the manual-run durations seen under each benchmark's data/ dir.
    timeout: 20 * 60 * 1000,
  }),
  webServer: {
    command: "jlpm start",
    url: "http://localhost:8888/lab",
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
};
