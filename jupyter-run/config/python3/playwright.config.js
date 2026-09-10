/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
import { defineConfig } from "playwright/test";
const baseConfig = require("@jupyterlab/galata/lib/playwright-config");
module.exports = {
  ...baseConfig,
  ...defineConfig({
    testDir: "../../ui",
    testMatch: "autotest-python3.spec.ts", // run-all (col E) + rerun manual set (col F)
    // 20 min: realworld initial run-all + manual rerun can be slow.
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
