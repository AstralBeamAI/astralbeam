import process from "node:process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@playwright/test"

const external = process.env.E2E_BASE_URL
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 4,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  outputDir: process.env.E2E_OUTPUT_DIR ?? join(tmpdir(), "linearity-react-evidence"),
  reporter: [["list"]],
  use: {
    baseURL: external ?? "http://127.0.0.1:4818",
    browserName: "chromium",
    httpCredentials: { username: "local-review", password: "linearity-local-only" },
    viewport: { width: 1440, height: 1000 },
    video: process.env.E2E_CAPTURE
      ? { mode: "on", size: { width: 1440, height: 1000 } }
      : "retain-on-failure",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: external
    ? []
    : {
        command: "bun run dev --host 127.0.0.1",
        url: "http://127.0.0.1:4818",
        reuseExistingServer: false,
        env: {
          PORT: "4818",
          BASIC_AUTH_USERNAME: "local-review",
          BASIC_AUTH_PASSWORD: "linearity-local-only",
          ASTRALBEAM_API_KEY: "",
        },
      },
})
