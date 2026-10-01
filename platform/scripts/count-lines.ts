import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"

// Registry-vendored UI and the generated route tree are excluded, matching the Oxlint ignores.
const generated = [/^src\/components\/ui\//, /^src\/routeTree\.gen\.ts$/]
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith("e2e/")

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((path) => /\.tsx?$/.test(path) && !generated.some((pattern) => pattern.test(path)))
  .filter((path) => existsSync(path))

const lines = { source: 0, test: 0 }
for (const path of files) {
  lines[isTest(path) ? "test" : "source"] += readFileSync(path, "utf8").split("\n").length - 1
}

const binary = ".output/astralbeam-platform"
const binaryMegabytes = existsSync(binary) ? (statSync(binary).size / 1e6).toFixed(1) : undefined
console.log(`Source lines: ${lines.source}`)
console.log(`Test lines: ${lines.test}`)
console.log(`Binary size: ${binaryMegabytes ? `${binaryMegabytes} MB` : "not built"}`)
