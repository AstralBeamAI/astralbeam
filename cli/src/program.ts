import { Command, CommanderError } from "commander"
import { stderr } from "node:process"
import packageJson from "../package.json" with { type: "json" }
import { registerAuthCommands } from "./auth.ts"
import { registerChatCommand } from "./chat.ts"
import { DEFAULT_API_URL, runState } from "./config.ts"
import { printError } from "./output.ts"
import { registerSkillCommands } from "./skill.ts"
import { registerTenantUserCommands } from "./tenant-users.ts"
import { registerTenantCommands } from "./tenants.ts"
import { registerTokenCommands } from "./token.ts"

const HELP_FOOTER = `
Environment:
  ASTRALBEAM_API_KEY     organization API key, used instead of directory logins
  ASTRALBEAM_API_URL     API base URL for ASTRALBEAM_API_KEY and login (default ${DEFAULT_API_URL})
  ASTRALBEAM_CONFIG_DIR  directory holding config.json

Exit codes: 0 success, 1 API or runtime failure, 2 invalid usage.
Docs: https://app.astralbeam.ai/docs/cli/getting-started`

/** Runs the CLI with Node-style argv and returns the process exit code. */
export async function run(argv: readonly string[]): Promise<number> {
  // Known before parsing, so a usage error in JSON mode replaces Commander's text output.
  const json = argv.includes("--json")
  const debug = argv.includes("--debug")
  // exitOverride and configureOutput precede the subcommands so each inherits them.
  const program = new Command("astralbeam")
    .description(
      "Manage an AstralBeam organization's Tenants, TenantUsers, tokens, and agent chats.",
    )
    .version(packageJson.version)
    .option("--json", "print JSON to stdout, and failures as JSON to stderr")
    .option("--debug", "log HTTP requests and failure stack traces to stderr, never headers")
    .addHelpText("after", HELP_FOOTER)
    .showHelpAfterError()
    .exitOverride()
  if (json) program.configureOutput({ writeErr: () => undefined })
  registerAuthCommands(program)
  registerTenantCommands(program)
  registerTenantUserCommands(program)
  registerTokenCommands(program)
  registerChatCommand(program)
  registerSkillCommands(program)
  Object.assign(runState, { json, context: undefined, failedRequest: undefined })
  const originalFetch = globalThis.fetch
  globalThis.fetch = tracedFetch(originalFetch, debug)
  try {
    await program.parseAsync(argv)
    if (json) stderr.write(`${JSON.stringify({ context: runState.context ?? null })}\n`)
    return 0
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      if (debug && error instanceof Error) stderr.write(`[debug] ${error.stack}\n`)
      printError(error, json, runState.context, runState.failedRequest)
      return 1
    }
    if (error.exitCode === 0) return 0
    if (json) {
      // A bare command group reports its help as the error, with the message "(outputHelp)".
      const detail =
        error.code === "commander.help"
          ? "Missing subcommand."
          : error.message.replace(/^error: /, "")
      printError(new Error(detail), true, runState.context)
    }
    return 2
  } finally {
    globalThis.fetch = originalFetch
  }
}

/**
 * Wraps fetch to remember the last failed request for error messages, name the URL when a request
 * cannot be sent, and with --debug log each request's method, URL, status, and duration.
 */
function tracedFetch(fetch: typeof globalThis.fetch, debug: boolean): typeof globalThis.fetch {
  return async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    const url = input instanceof Request ? input.url : String(input)
    const started = performance.now()
    if (debug) stderr.write(`[debug] → ${method} ${url}\n`)
    let response: Response
    try {
      response = await fetch(input, init)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      // Node and Deno put the network reason, such as ECONNREFUSED, in the cause.
      const reason = error.cause instanceof Error ? error.cause.message : error.message
      throw new Error(`Could not reach ${url}: ${reason}`, { cause: error })
    }
    const elapsed = Math.round(performance.now() - started)
    if (debug) stderr.write(`[debug] ← ${response.status} ${response.statusText} (${elapsed} ms)\n`)
    if (!response.ok) runState.failedRequest = `${method} ${url}`
    return response
  }
}
