import { spawnSync } from "node:child_process"
import process from "node:process"

import { databaseUrl } from "../drizzle.config.ts"

// `test` skips the integration suites without a `_test` database, so recreate this worktree's copy.
const url = new URL(databaseUrl!)
url.pathname = `${url.pathname.replace(/_test$/, "")}_test`
const env = { ...process.env, DATABASE_URL: url.href }
for (const task of [
  ["db-reset"],
  ["db", "migrate"],
  ["test", "--project=integration", ...process.argv.slice(2)],
]) {
  const { status } = spawnSync(process.execPath, ["run", ...task], { env, stdio: "inherit" })
  if (status !== 0) process.exit(status ?? 1)
}
