import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const e2eDirectory = dirname(fileURLToPath(import.meta.url))
const webappDirectory = join(e2eDirectory, "..")
const repositoryRoot = join(webappDirectory, "..")

/**
 * Ports are derived from the worktree path so a worktree always uses the same three and two
 * worktrees can run at once. The range stays clear of 4500 and of the todos suite's 14500 block.
 */
const E2E_PORT_BASE = 15_500
const E2E_PORT_SLOTS = 400
const E2E_PORTS_PER_SLOT = 3

function derivePortBase(seed: string): number {
  // FNV-1a, for a stable spread across worktree paths without a hash dependency.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return E2E_PORT_BASE + (hash % E2E_PORT_SLOTS) * E2E_PORTS_PER_SLOT
}

const portBase = derivePortBase(repositoryRoot)

const webappPort = Number(process.env.E2E_WEBAPP_PORT ?? portBase)
const mailboxApiPort = Number(process.env.E2E_MAILBOX_PORT ?? portBase + 2)

/** The journey types this into `/configure`, which is how the deployment learns where to send mail. */
export const mailboxSmtpPort = Number(process.env.E2E_SMTP_PORT ?? portBase + 1)

export const webappUrl = `http://localhost:${webappPort}`
export const mailboxUrl = `http://127.0.0.1:${mailboxApiPort}`

/** Vite's precedence order, lowest first. Only plain `KEY=value` lines are read. https://vite.dev/guide/env-and-mode */
const WEBAPP_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"]

function readWebappEnvironmentFiles(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const fileName of WEBAPP_ENV_FILES) {
    const path = join(webappDirectory, fileName)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([a-z_]\w*)=(.*)$/i.exec(line)
      if (!match?.[1]) continue
      values[match[1]] = (match[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1")
    }
  }
  return values
}

const webappEnvironment = readWebappEnvironmentFiles()

function requireWebappEnvironmentValue(key: string): string {
  const value = process.env[key] || webappEnvironment[key]
  if (!value) throw new Error(`${key} is not set in the environment or in webapp/.env*`)
  return value
}

/** The first comma-separated entry is the active key, which is the one `/configure` accepts. */
export const operatorKey = requireWebappEnvironmentValue("DATABASE_ENCRYPTION_KEY")
  .split(",")[0]!
  .trim()

/**
 * The suite owns a database beside the worktree's own, so a run never touches development data and
 * always starts empty. `E2E_DATABASE_URL` points it somewhere else.
 */
function deriveE2eDatabaseUrl(): string {
  const configured = process.env.E2E_DATABASE_URL
  if (configured) return configured
  const url = new URL(requireWebappEnvironmentValue("DATABASE_URL"))
  url.pathname = `${url.pathname}_e2e`
  return url.href
}

export const e2eDatabaseUrl = deriveE2eDatabaseUrl()

/**
 * `E2E_CAPTURE=all` records video, a trace, and a screenshot even for a passing spec, which is
 * what you want when the run itself is the evidence for a pull request.
 */
export const captureEverything = process.env.E2E_CAPTURE === "all"

/**
 * Pins one Docker endpoint for the whole run. The CLI resolves its endpoint through contexts while
 * the server's client reads `DOCKER_HOST`, so with it unset the two can disagree and the spec's
 * probe passes against a daemon the application never reaches.
 * https://docs.docker.com/engine/manage-resources/contexts/
 */
function pinDockerHost(): void {
  if (process.env.DOCKER_HOST) return
  const probe = spawnSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  )
  if (probe.status === 0 && probe.stdout.trim()) process.env.DOCKER_HOST = probe.stdout.trim()
}

pinDockerHost()

/** Saving a sandbox provider runs a real connection test, so that step needs a live daemon. */
export function dockerDaemonAvailable(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
}

/** Playwright `webServer` entries: the mail sink first, because the webapp is pointed at it. */
export function e2eWebServers() {
  return [
    {
      command: "deno run -P=tooling ./e2e/mailbox-server.ts",
      cwd: webappDirectory,
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
      command: "deno run -P=tooling ./e2e/prepare-database.ts && deno task dev",
      cwd: webappDirectory,
      url: `${webappUrl}/api/status`,
      env: {
        PORT: String(webappPort),
        DATABASE_URL: e2eDatabaseUrl,
        // Better Auth would otherwise take its base URL from stored configuration and reject
        // requests arriving on the suite's port. Everything else is set through `/configure`.
        APP_BASE_URL: webappUrl,
        // Explicit, so the server's sandbox client uses the same daemon the spec probed.
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      },
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    },
  ]
}
