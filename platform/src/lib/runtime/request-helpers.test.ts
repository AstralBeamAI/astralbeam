import { globSync, readFileSync } from "node:fs"

import { expect, it } from "vitest"

const sourceRoot = new URL("../../", import.meta.url)

// Effect code may resume in another request's async context, so only the runtime captures one.
it("keeps TanStack request and response helpers inside src/lib/runtime", () => {
  const importers = globSync("**/*.{ts,tsx}", {
    cwd: sourceRoot,
    exclude: ["lib/runtime/**", "**/*.test.*"],
  }).filter((path) =>
    readFileSync(new URL(path, sourceRoot), "utf8").includes('"@tanstack/react-start/server"'),
  )
  expect(importers).toEqual([])
})
