import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "Chrome", use: { browserName: "chromium", channel: "chrome" } },
    { name: "Edge", use: { browserName: "chromium", channel: "msedge" } },
    { name: "Firefox", use: { browserName: "firefox" } }
  ]
});
