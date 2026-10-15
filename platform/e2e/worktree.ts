import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { pinDockerHost, worktreeHash } from "./bootstrap.ts"

const e2eDirectory = dirname(fileURLToPath(import.meta.url))
const platformDirectory = join(e2eDirectory, "..")
const repositoryRoot = join(platformDirectory, "..")

/**
 * Ports are derived from the worktree path so a worktree always uses the same three and two
 * worktrees can run at once. The range stays clear of 4500 and of the todos suite's 14500 block.
 */
const E2E_PORT_BASE = 15_500
const E2E_PORT_SLOTS = 400
const E2E_PORTS_PER_SLOT = 3

const portBase =
  E2E_PORT_BASE + (worktreeHash(repositoryRoot) % E2E_PORT_SLOTS) * E2E_PORTS_PER_SLOT

const platformPort = Number(process.env.E2E_PLATFORM_PORT ?? portBase)
const mailboxApiPort = Number(process.env.E2E_MAILBOX_PORT ?? portBase + 2)

/** The journey types this into `/configure`, which is how the deployment learns where to send mail. */
export const mailboxSmtpPort = Number(process.env.E2E_SMTP_PORT ?? portBase + 1)

/**
 * `E2E_SEEDED=1` (`bun run e2e:seeded`) runs `specs/seeded` against the worktree's seeded
 * database instead, signed in as the seeded owner. `E2E_PLATFORM_URL` reuses a running server.
 */
export const seededMode = process.env.E2E_SEEDED === "1"
const externalPlatformUrl = seededMode ? process.env.E2E_PLATFORM_URL : undefined

export const platformUrl = externalPlatformUrl ?? `http://localhost:${platformPort}`
export const mailboxUrl = `http://127.0.0.1:${mailboxApiPort}`

/** Vite's precedence order, lowest first. Only plain `KEY=value` lines are read. https://vite.dev/guide/env-and-mode */
const PLATFORM_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"]

function readPlatformEnvironmentFiles(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const fileName of PLATFORM_ENV_FILES) {
    const path = join(platformDirectory, fileName)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([a-z_]\w*)=(.*)$/i.exec(line)
      if (!match?.[1]) continue
      values[match[1]] = (match[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1")
    }
  }
  return values
}

const platformEnvironment = readPlatformEnvironmentFiles()

function requirePlatformEnvironmentValue(key: string): string {
  const value = process.env[key] || platformEnvironment[key]
  if (!value) throw new Error(`${key} is not set in the environment or in platform/.env*`)
  return value
}

/** Disposable runs use a synthetic key. Seeded runs use the deployment's active key. */
export const operatorKey = seededMode
  ? requirePlatformEnvironmentValue("DATABASE_ENCRYPTION_KEY").split(",")[0]!.trim()
  : "e2e-only-operator-encryption-key-0000000000000000"

/**
 * The suite owns a database beside the worktree's own, so a run never touches development data and
 * always starts empty. `E2E_DATABASE_URL` points it somewhere else.
 */
function deriveE2eDatabaseUrl(): string {
  const configured = process.env.E2E_DATABASE_URL
  if (configured) return configured
  const url = new URL(requirePlatformEnvironmentValue("DATABASE_URL"))
  url.pathname = `${url.pathname}_e2e`
  return url.href
}

export const e2eDatabaseUrl = deriveE2eDatabaseUrl()

/**
 * `E2E_CAPTURE=all` records video, a trace, and a screenshot even for a passing spec, which is
 * what you want when the run itself is the evidence for a pull request.
 */
export const captureEverything = process.env.E2E_CAPTURE === "all" || seededMode

pinDockerHost()

/**
 * Saving a sandbox provider runs the product's real connection test, which creates, uses, and
 * destroys a container and may pull its image, so that project is opt-in rather than ambient.
 */
export const sandboxSpecsEnabled = process.env.E2E_SANDBOX === "docker"

export function dockerDaemonAvailable(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
}

/** Playwright `webServer` entries: the mail sink first, because the platform is pointed at it. */
export function e2eWebServers() {
  if (seededMode) {
    if (externalPlatformUrl) return []
    return [
      {
        command: "bun run dev",
        cwd: platformDirectory,
        // Wait for the server graph, not just Vite's static asset middleware.
        url: `${platformUrl}/api/status`,
        env: { PORT: String(platformPort), APP_BASE_URL: platformUrl },
        reuseExistingServer: false,
        timeout: 240_000,
        gracefulShutdown: { signal: "SIGTERM" as const, timeout: 8_000 },
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      },
    ]
  }
  return [
    {
      command: "bun run ./e2e/mailbox-server.ts",
      cwd: platformDirectory,
      url: `${mailboxUrl}/health`,
      env: {
        E2E_SMTP_PORT: String(mailboxSmtpPort),
        E2E_MAILBOX_PORT: String(mailboxApiPort),
      },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    },
    {
      // The database is prepared here rather than in `globalSetup`, which Playwright runs only
      // after it has already started the web servers.
      command: "bun run ./e2e/prepare-database.ts && bun run dev",
      cwd: platformDirectory,
      // Wait for the server graph, not just Vite's static asset middleware.
      url: `${platformUrl}/api/status`,
      env: {
        PORT: String(platformPort),
        DATABASE_URL: e2eDatabaseUrl,
        DATABASE_ENCRYPTION_KEY: operatorKey,
        BETTER_AUTH_SECRET: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GITHUB_CLIENT_ID: "",
        GITHUB_CLIENT_SECRET: "",
        RESEND_API_KEY: "",
        AWS_ACCESS_KEY_ID: "",
        AWS_SECRET_ACCESS_KEY: "",
        // Keep operator storage fields editable regardless of development overrides.
        S3_ENDPOINT: "",
        S3_REGION: "",
        S3_BUCKET: "",
        S3_ACCESS_KEY_ID: "",
        S3_SECRET_ACCESS_KEY: "",
        S3_PATH_STYLE: "",
        CLOUDFRONT_DOWNLOAD_ORIGIN: "",
        CLOUDFRONT_KEY_PAIR_ID: "",
        CLOUDFRONT_PRIVATE_KEY: "",
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "",
        SMTP_SECURITY: "none",
        SMTP_USERNAME: "",
        SMTP_PASSWORD: "",
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        SUPPORT_EMAIL_ADDRESS: "support@example.com",
        // Better Auth would otherwise take its base URL from stored configuration and reject
        // requests arriving on the suite's port.
        APP_BASE_URL: platformUrl,
        // Explicit, so the server's sandbox client uses the same daemon the spec probed.
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      },
      reuseExistingServer: false,
      timeout: 240_000,
      gracefulShutdown: { signal: "SIGTERM" as const, timeout: 8_000 },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    },
  ]
}
