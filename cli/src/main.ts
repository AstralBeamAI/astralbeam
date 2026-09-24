#!/usr/bin/env node
import process from "node:process"
import { run } from "./program.ts"

// Setting exitCode rather than calling exit() lets piped stdout drain first.
process.exitCode = await run(process.argv)
