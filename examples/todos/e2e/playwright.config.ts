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
 * One shared webapp, one agent backend, and one Docker daemon serve every spec, so the suite runs
 * serially. Specs are routed to projects by folder rather than by tag:
 *
 * - `specs/app` is deterministic and free; it never calls a model.
 * - `specs/agent` drives a real agent run, so it spends model credits and is skipped without a key.
 *
 * `preflight.setup.ts` is a dependency of both, so a database that has not been seeded fails once
 * with an actionable message instead of failing every spec.
 */
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "./.output/test-results",
  reporter: [["list"], ["html", { outputFolder: "./.output/report", open: "never" }]],
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
    { name: "app", testDir: "./specs/app", dependencies: ["preflight"], retries: 0 },
    ...(agentSpecsEnabled
      ? [{
        name: "agent",
        testDir: "./specs/agent",
        dependencies: ["preflight"],
        // Model output varies between runs, so one retry absorbs a reply that skipped a tool.
        retries: 1,
        // Generous, because a throttled turn waits out the endpoint's one-minute window.
        timeout: 300_000,
      }]
      : []),
  ],
  webServer: e2eWebServers(),
})
