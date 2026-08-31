/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
import { defineConfig } from "playwright/test";
const baseConfig = require("@jupyterlab/galata/lib/playwright-config");
module.exports = {
  ...baseConfig,
  ...defineConfig({
    testDir: "../../ui",
    testMatch: "autotest-baseline.spec.ts", // plain run-all baseline (column E)
    timeout: 600 * 1000,
  }),
  webServer: {
    command: "jlpm start",
    url: "http://localhost:8888/lab",
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
};
