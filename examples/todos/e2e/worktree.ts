import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { SEED_TODOS_TARGET } from "../../../webapp/scripts/seed/fixtures.ts"

/**
 * Resolves everything about this worktree the suite needs: where the projects are, which ports its
 * servers use, and which environment values to hand them. Update this file when project layout,
 * ports, or required server environment change; the specs themselves never read the environment.
 *
 * Keep this module's imports to `node:*` and plain data. Playwright loads the config in its own
 * process, and importing `vite` here drags in rolldown's native binding, which fails to resolve
 * under Deno's node_modules layout.
 */

const e2eDirectory = dirname(fileURLToPath(import.meta.url))
const todosDirectory = join(e2eDirectory, "..")
const repositoryRoot = join(todosDirectory, "..", "..")
const webappDirectory = join(repositoryRoot, "webapp")
const sdkDistDirectory = join(repositoryRoot, "sdk", "dist")

/**
 * Ports are derived from the worktree path rather than probed, so a given worktree always uses the
 * same pair: the URL in a failure report stays openable, and two worktrees running at once do not
 * collide. Both servers set `strictPort`, so an occupied port fails loudly instead of drifting.
 * The range deliberately avoids the 4500/4700 development ports, so a suite run never fights a
 * server someone is using by hand.
 */
const E2E_PORT_BASE = 14_500
const E2E_PORT_SLOTS = 500

function derivePortPair(seed: string): { webapp: number; todos: number } {
  // FNV-1a, for a stable spread across worktree paths without a hash dependency.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const webapp = E2E_PORT_BASE + (hash % E2E_PORT_SLOTS) * 2
  return { webapp, todos: webapp + 1 }
}

const ports = derivePortPair(repositoryRoot)
const webappPort = Number(process.env.E2E_WEBAPP_PORT ?? ports.webapp)
const todosPort = Number(process.env.E2E_TODOS_PORT ?? ports.todos)

/**
 * The webapp's environment files, in Vite's precedence order, lowest first. Only plain `KEY=value`
 * lines are read, which is all these files contain and all the repository's own scripts assume.
 * https://vite.dev/guide/env-and-mode
 */
const WEBAPP_ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local"]

function readWebappEnvFiles(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const fileName of WEBAPP_ENV_FILES) {
    const path = join(webappDirectory, fileName)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line)
      if (!match?.[1]) continue
      values[match[1]] = (match[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1")
    }
  }
  return values
}

const webappEnv = readWebappEnvFiles()

function webappEnvValue(key: string): string | undefined {
  return process.env[key] || webappEnv[key] || undefined
}

/** Set to reuse servers that are already running, instead of letting the suite start its own. */
const externalWebappUrl = process.env.E2E_WEBAPP_URL
const externalTodosUrl = process.env.E2E_TODOS_URL

export const webappUrl = externalWebappUrl ?? `http://localhost:${webappPort}`
export const todosUrl = externalTodosUrl ?? `http://localhost:${todosPort}`

export const seedTarget = SEED_TODOS_TARGET

/** Agent specs spend real model credits, so they only run when a key is actually configured. */
export const agentSpecsEnabled = Boolean(webappEnvValue("OPENAI_API_KEY"))

/**
 * Pins one Docker endpoint for the whole run.
 *
 * The `docker` CLI resolves its endpoint through contexts, while the sandbox provider's client
 * reads `DOCKER_HOST` and otherwise guesses a default. With `DOCKER_HOST` unset the two can
 * disagree, which is worth avoiding: the sandbox spec skips itself on what the CLI reports, so a
 * disagreement once let it pass against a sandbox that had never started. Resolving the CLI's own
 * endpoint into the environment makes both sides agree, whatever Docker runtime is installed.
 * https://docs.docker.com/engine/manage-resources/contexts/
 */
function pinDockerHost(): void {
  if (process.env.DOCKER_HOST) return
  const probe = spawnSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  )
  const host = probe.status === 0 ? probe.stdout.trim() : ""
  if (host) process.env.DOCKER_HOST = host
}

pinDockerHost()

/**
 * `E2E_CAPTURE=all` records video, a trace, and an end-of-test screenshot for every spec, passing
 * or not, which is what you want when the run itself is the evidence for a pull request. Left
 * unset, all three are kept only for a failure, so a green run stays fast and quiet.
 */
export const captureEverything = process.env.E2E_CAPTURE === "all"

export function assertSdkIsBuilt(): void {
  if (existsSync(sdkDistDirectory)) return
  throw new Error(
    "The SDK is not built: examples/todos consumes sdk/dist. Run `deno task build` from `sdk`.",
  )
}

/**
 * The webapp dev server loads its own env files, so only what the suite changes is forwarded: its
 * port, and the base URL Better Auth derives from configuration. Without the override Better Auth
 * would use the seeded `app_base_url` and reject requests arriving on the suite's port.
 */
function forwardedWebappEnv(): Record<string, string> {
  return {
    PORT: String(webappPort),
    APP_BASE_URL: webappUrl,
    // Explicit, so the server's sandbox client uses the same daemon the specs probed.
    ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
  }
}

/** Playwright `webServer` entries. Empty for a server the operator is already running. */
export function e2eWebServers() {
  return [
    ...(externalWebappUrl ? [] : [{
      command: "deno task dev",
      cwd: webappDirectory,
      url: `${webappUrl}/api/status`,
      env: forwardedWebappEnv(),
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    }]),
    ...(externalTodosUrl ? [] : [{
      command: "deno task dev",
      cwd: todosDirectory,
      url: todosUrl,
      env: {
        PORT: String(todosPort),
        // The confidential key the token route signs with, and the browser-safe agent it targets.
        ASTRALBEAM_API_KEY: seedTarget.apiKey,
        VITE_ASTRALBEAM_AGENT_ID: seedTarget.agentId,
        VITE_ASTRALBEAM_API_URL: `${webappUrl}/api`,
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    }]),
  ]
}
