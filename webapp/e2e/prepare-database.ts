import { spawnSync } from "node:child_process"
import process from "node:process"

/**
 * Drops, recreates, and migrates the suite's own database before its webapp server starts. Both
 * steps go through the project's own tasks, which read `DATABASE_URL` from this process.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const url = new URL(databaseUrl)
const databaseName = url.pathname.slice(1)

// This drops a database, so it refuses anything that is not the suite's own local one.
if (!LOOPBACK_HOSTS.has(url.hostname)) {
  throw new Error(`Refusing to reset '${databaseName}' on non-loopback host ${url.hostname}`)
}
if (!databaseName.endsWith("_e2e")) {
  throw new Error(`Refusing to reset '${databaseName}', whose name does not end in _e2e`)
}

for (const task of [["db-reset"], ["db", "migrate"]]) {
  const result = spawnSync("deno", ["task", ...task], { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`\`deno task ${task.join(" ")}\` failed for database '${databaseName}'`)
  }
}

console.log(`Prepared end-to-end database '${databaseName}'.`)
