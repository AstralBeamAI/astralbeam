// Runs a project's `ready` steps in order, each as `deno task <step>`. `--no-<step>` skips one.
// Outside CI it formats first, so a formatting slip never fails a full run.
const steps = Deno.args.filter((arg) => !arg.startsWith("--"))
const skipped = new Set(
  Deno.args.filter((arg) => arg.startsWith("--no-")).map((arg) => arg.slice("--no-".length)),
)

const unknown = [...skipped].filter((step) => step !== "format" && !steps.includes(step))
if (unknown.length > 0) {
  console.error(`Unknown step: ${unknown.join(", ")}. Steps: format, ${steps.join(", ")}`)
  Deno.exit(2)
}
if (!Deno.env.get("CI")) steps.unshift("format")

for (const step of steps.filter((step) => !skipped.has(step))) {
  const started = performance.now()
  const { code } = await new Deno.Command("deno", { args: ["task", step] }).spawn().status
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  if (code !== 0) {
    console.error(`\nready: ${step} failed after ${seconds}s`)
    Deno.exit(code)
  }
  console.log(`\nready: ${step} passed in ${seconds}s\n`)
}
