import { spawnSync } from "node:child_process"
import process from "node:process"
import { expect, test } from "vitest"

test.each([
  ["push"],
  ["push", "--explain"],
  ["push:pg"],
  ["pull", "--init"],
  ["introspect", "--init"],
  ["--help", "push"],
])("rejects bypass command %j before invoking Drizzle Kit", (...args) => {
  const result = spawnSync(
    process.execPath,
    [
      "run",
      "--frozen",
      "--no-prompt",
      "--allow-read",
      "--allow-env",
      "--allow-sys",
      "--allow-ffi",
      "scripts/database.ts",
      ...args,
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10_000 },
  )

  expect(result.status).toBe(1)
  expect(result.stderr).toContain("Unsupported database command")
  expect(result.stderr).toContain("deno task db migrate")
})
