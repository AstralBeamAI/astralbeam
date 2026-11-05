import process from "node:process"

import { defineConfig } from "@playwright/test"

import {
  agentSpecsEnabled,
  assertSdkIsBuilt,
  captureEverything,
  e2eWebServers,
  todosUrl,
} from "./worktree.ts"

assertSdkIsBuilt()

/**
 * App specs use isolated browser contexts and run in parallel. Agent specs run serially afterwards
 * because they share a tenant user's rate limits and Docker daemon. Specs are routed by folder:
 *
 * - `specs/app` is deterministic and free; it never calls a model.
 * - `specs/agent` drives a real agent run, so it spends model credits and is skipped without a key.
 *
 * `preflight.setup.ts` is a dependency of both, so a database that has not been seeded fails once
 * with an actionable message instead of failing every spec.
 */
export default defineConfig({
  fullyParallel: false,
  workers: 4,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "./.output/test-results",
  // printSteps narrates each `test.step` with its duration, which is most of what an agent run does.
  reporter: [
    ["list", { printSteps: true }],
    ["html", { outputFolder: "./.output/report", open: "never" }],
  ],
  use: {
    browserName: "chromium",
    baseURL: todosUrl,
    // Video is the useful artefact for an agent run, where the interesting part is the streaming
    // transcript rather than any single frame. Traces stay on for step-by-step inspection.
    video: captureEverything ? "on" : "retain-on-failure",
    screenshot: captureEverything ? "on" : "only-on-failure",
    trace: captureEverything ? "on" : "retain-on-failure",
  },
  projects: [
    { name: "preflight", testMatch: /preflight\.setup\.ts/ },
    {
      name: "app",
      testDir: "./specs/app",
      dependencies: ["preflight"],
      fullyParallel: true,
      retries: 0,
    },
    ...(agentSpecsEnabled
      ? [
          {
            name: "agent",
            testDir: "./specs/agent",
            dependencies: ["app"],
            workers: 1,
            // Model output varies between runs, so one retry absorbs a reply that skipped a tool.
            retries: 1,
            // Generous, because a throttled turn waits out the endpoint's one-minute window.
            timeout: 300_000,
          },
        ]
      : []),
  ],
  webServer: e2eWebServers(),
})
