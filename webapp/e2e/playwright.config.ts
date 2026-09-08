import process from "node:process"

import { defineConfig } from "@playwright/test"

import { captureEverything, e2eWebServers, webappUrl } from "./worktree.ts"

/**
 * One webapp, one database, and one mail sink serve every spec, so the suite runs serially.
 * `preflight.setup.ts` runs first so an environment problem fails once with something to act on.
 */
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "./.output/test-results",
  reporter: [["list"], ["html", { outputFolder: "./.output/report", open: "never" }]],
  // The suite drives the Vite dev server, which compiles a route the first time it is visited, so
  // the default five seconds is short for a first navigation or a first server-function call.
  expect: { timeout: 20_000 },
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    browserName: "chromium",
    baseURL: webappUrl,
    // Wide enough that the sidebar stays expanded, which is where most navigation lives.
    viewport: { width: 1440, height: 900 },
    video: captureEverything ? "on" : "retain-on-failure",
    screenshot: captureEverything ? "on" : "only-on-failure",
    trace: captureEverything ? "on" : "retain-on-failure",
  },
  projects: [
    { name: "preflight", testMatch: /preflight\.setup\.ts/ },
    {
      name: "dashboard",
      testDir: "./specs",
      dependencies: ["preflight"],
      retries: 0,
      // The journey covers the whole product in one browser session.
      timeout: 600_000,
    },
  ],
  webServer: e2eWebServers(),
})
