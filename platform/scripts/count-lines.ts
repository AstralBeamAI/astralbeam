import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"

// Registry output carries its `Added with:` provenance header, and tools mark their own output.
const generatedHeader =
  /^\/\/ (?:(?:Previously added|Added) with: |This file was automatically generated)/m
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith("e2e/")

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((path) => /\.tsx?$/.test(path) && existsSync(path))

const lines = { handwritten: 0, generated: 0, test: 0 }
for (const path of files) {
  const source = readFileSync(path, "utf8")
  const kind = isTest(path)
    ? "test"
    : /^src\/components\/ui\/|\.gen\.ts$/.test(path) || generatedHeader.test(source.slice(0, 500))
      ? "generated"
      : "handwritten"
  lines[kind] += source.split("\n").length - 1
}

const binary = ".output/astralbeam-platform"
const binaryMegabytes = existsSync(binary) ? (statSync(binary).size / 1e6).toFixed(1) : undefined
console.log(`Handwritten source lines: ${lines.handwritten}`)
console.log(`Generated source lines: ${lines.generated}`)
console.log(`Test lines: ${lines.test}`)
console.log(`Binary size: ${binaryMegabytes ? `${binaryMegabytes} MB` : "not built"}`)
