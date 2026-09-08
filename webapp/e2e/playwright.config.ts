import { defineConfig } from "@playwright/test"

import { baselineStatePath } from "./baseline.ts"
import { captureEverything, e2eWebServers, sandboxSpecsEnabled, webappUrl } from "./worktree.ts"

/**
 * One webapp, one database, and one mail sink serve every spec, so the suite runs serially and
 * each project depends on the state the previous one established:
 *
 * - `preflight` fails once, with something to act on, when the environment is not ready.
 * - `journey` drives the whole product from an unconfigured deployment and records its baseline.
 * - `features` holds focused specs, which start from that baseline and the owner's session.
 * - `sandbox` exists only under `E2E_SANDBOX=docker`, because its specs run real containers.
 */
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  // Unconditional, because this suite never runs in CI: nothing else would catch a stray
  // `test.only`. Use `--project` or `-g` for focused iteration instead.
  forbidOnly: true,
  outputDir: "./.output/test-results",
  // printSteps narrates each `test.step` with its duration, which is most of what a run does.
  reporter: [
    ["list", { printSteps: true }],
    ["html", { outputFolder: "./.output/report", open: "never" }],
  ],
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
      name: "journey",
      testDir: "./specs/journey",
      dependencies: ["preflight"],
      // Generous, because one test covers the whole product in a single browser session.
      timeout: 600_000,
    },
    {
      name: "features",
      testDir: "./specs/features",
      dependencies: ["journey"],
      use: { storageState: baselineStatePath },
    },
    ...(sandboxSpecsEnabled
      ? [{
        name: "sandbox",
        testDir: "./specs/sandbox",
        dependencies: ["journey"],
        use: { storageState: baselineStatePath },
        // Generous, because a first run pulls the image before the container starts.
        timeout: 300_000,
      }]
      : []),
  ],
  webServer: e2eWebServers(),
})
