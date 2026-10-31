import yargs from "yargs"
import { UsageError } from "./options.ts"
import * as apiCommands from "./generated/index.ts"
import { stderr } from "node:process"
import packageJson from "../package.json" with { type: "json" }
import { registerAuthCommands } from "./auth.ts"
import { registerChatCommand } from "./chat.ts"
import { DEFAULT_API_URL, runState } from "./config.ts"
import { printError } from "./output.ts"
import { registerSkillCommands } from "./skill.ts"
import { registerTokenCommands } from "./token.ts"

const HELP_FOOTER = `
Environment:
  ASTRALBEAM_API_KEY     organization API key, used instead of directory logins
  ASTRALBEAM_API_URL     override the saved API URL (default ${DEFAULT_API_URL})
  ASTRALBEAM_CONFIG_DIR  directory holding config.json

Exit codes: 0 success, 1 API or runtime failure, 2 parser usage errors.
Docs: https://astralbeam.ai/docs/cli/getting-started`

/** Runs the CLI with Node-style argv and returns the process exit code. */
export async function run(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json")
  const debug = argv.includes("--debug")
  const program = yargs(argv.slice(2))
    .scriptName("astralbeam")
    .version(packageJson.version)
    .option("json", {
      type: "boolean",
      default: false,
      description: "Print JSON instead of human-readable output",
    })
    .option("debug", {
      type: "boolean",
      default: false,
      description: "Log HTTP requests and errors without headers",
    })
    .strict()
    .demandCommand(1)
    .help()
    .exitProcess(false)
    .fail((message, error) => {
      throw new UsageError(message || error?.message || "Invalid command.")
    })
    .epilog(HELP_FOOTER)
    .alias("q", "search")
    .command(Object.values(apiCommands))
    .command(
      "auth",
      "Bind organization API keys to directories, and check them",
      registerAuthCommands,
    )
    .command(
      "token",
      "Mint short-lived JWTs offline with the organization API key",
      registerTokenCommands,
    )
    .command(
      "skill",
      "Print or install the Agent Skill that teaches coding agents this CLI",
      registerSkillCommands,
    )
  registerChatCommand(program)
  Object.assign(runState, { json, context: undefined, failedRequest: undefined })
  const originalFetch = globalThis.fetch
  globalThis.fetch = tracedFetch(originalFetch, debug)
  try {
    await program.parseAsync()
    if (json) stderr.write(`${JSON.stringify({ context: runState.context ?? null })}\n`)
    return 0
  } catch (error) {
    if (debug && error instanceof Error) stderr.write(`[debug] ${error.stack}\n`)
    printError(error, json, runState.context, runState.failedRequest)
    return error instanceof UsageError ? 2 : 1
  } finally {
    globalThis.fetch = originalFetch
  }
}

/**
 * Wraps fetch to remember the last failed request for error messages, name the URL when a request
 * cannot be sent, and with --debug log each request's method, URL, status, and duration.
 */
function tracedFetch(fetch: typeof globalThis.fetch, debug: boolean): typeof globalThis.fetch {
  const traced = async (...[input, init]: Parameters<typeof fetch>) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    const url = input instanceof Request ? input.url : String(input)
    const started = performance.now()
    if (debug) stderr.write(`[debug] → ${method} ${url}\n`)
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      // Node and Bun put the network reason, such as ECONNREFUSED, in the cause.
      const reason = error.cause instanceof Error ? error.cause.message : error.message
      throw new Error(`Could not reach ${url}: ${reason}`, { cause: error })
    }
    const elapsed = Math.round(performance.now() - started)
    if (debug) stderr.write(`[debug] ← ${response.status} ${response.statusText} (${elapsed} ms)\n`)
    if (!response.ok) runState.failedRequest = `${method} ${url}`
    return response
  }
  return Object.assign(traced, fetch)
}
