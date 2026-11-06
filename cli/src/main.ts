#!/usr/bin/env node
import process from "node:process"
// Honor NO_COLOR before dependencies initialize, keeping their color warning out of JSON stderr.
if (process.env["NO_COLOR"] !== undefined) delete process.env["FORCE_COLOR"]
const { run } = await import("./program.ts")

// Setting exitCode rather than calling exit() lets piped stdout drain first.
process.exitCode = await run(process.argv)
