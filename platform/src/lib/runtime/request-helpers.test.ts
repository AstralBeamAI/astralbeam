import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, it } from "vitest"

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url))
const runtimeDirectory = fileURLToPath(new URL("./", import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : []
  })
}

// Effect code may resume in another request's async context, so only the runtime captures one.
it("keeps TanStack request and response helpers inside src/lib/runtime", () => {
  const importers = sourceFiles(sourceRoot).filter(
    (path) =>
      !path.startsWith(runtimeDirectory) &&
      readFileSync(path, "utf8").includes('"@tanstack/react-start/server"'),
  )
  expect(importers.map((path) => relative(sourceRoot, path))).toEqual([])
})
