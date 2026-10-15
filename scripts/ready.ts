import { spawn } from "node:child_process"
import process from "node:process"

// Runs a project's `ready` steps in order, each as `bun run <step>`. `--no-<step>` skips one.
// Outside CI it formats first, so a formatting slip never fails a full run.
const steps = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const skipped = new Set(
  process.argv.slice(2).filter((arg) => arg.startsWith("--no-")).map((arg) => arg.slice("--no-".length)),
)

const unknown = [...skipped].filter((step) => step !== "format" && !steps.includes(step))
if (unknown.length > 0) {
  console.error(`Unknown step: ${unknown.join(", ")}. Steps: format, ${steps.join(", ")}`)
  process.exit(2)
}
if (!process.env.CI) steps.unshift("format")

for (const step of steps.filter((step) => !skipped.has(step))) {
  const started = performance.now()
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["run", step], { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  if (code !== 0) {
    console.error(`\nready: ${step} failed after ${seconds}s`)
    process.exit(code)
  }
  console.log(`\nready: ${step} passed in ${seconds}s\n`)
}
