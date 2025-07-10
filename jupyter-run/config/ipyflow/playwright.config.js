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
  }),
  webServer: {
    command: "jlpm start",
    url: "http://localhost:8888/lab",
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
};
