import { Command, CommanderError } from "commander"
import packageJson from "../package.json" with { type: "json" }
import { registerAuthCommands } from "./auth.ts"
import { registerChatCommand } from "./chat.ts"
import { DEFAULT_API_URL } from "./config.ts"
import { printError } from "./output.ts"
import { registerSkillCommands } from "./skill.ts"
import { registerTenantUserCommands } from "./tenant-users.ts"
import { registerTenantCommands } from "./tenants.ts"
import { registerTokenCommands } from "./token.ts"

const HELP_FOOTER = `
Environment:
  ASTRALBEAM_API_KEY     organization API key, used instead of a stored profile
  ASTRALBEAM_API_URL     API base URL (default ${DEFAULT_API_URL})
  ASTRALBEAM_PROFILE     stored profile name (default "default")
  ASTRALBEAM_CONFIG_DIR  directory holding config.json

Exit codes: 0 success, 1 API or runtime failure, 2 invalid usage.
Docs: https://app.astralbeam.ai/docs/cli/getting-started`

/** Runs the CLI with Node-style argv and returns the process exit code. */
export async function run(argv: readonly string[]): Promise<number> {
  // Known before parsing, so a usage error in JSON mode replaces Commander's text output.
  const json = argv.includes("--json")
  // exitOverride and configureOutput precede the subcommands so each inherits them.
  const program = new Command("astralbeam")
    .description(
      "Manage an AstralBeam organization's Tenants, TenantUsers, tokens, and agent chats.",
    )
    .version(packageJson.version)
    .option("--json", "print JSON to stdout, and failures as JSON to stderr")
    .option("--profile <name>", "stored profile to use, overriding ASTRALBEAM_API_KEY")
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
  try {
    await program.parseAsync(argv)
    return 0
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      printError(error, json)
      return 1
    }
    if (error.exitCode === 0) return 0
    if (json) {
      // A bare command group reports its help as the error, with the message "(outputHelp)".
      const detail =
        error.code === "commander.help"
          ? "Missing subcommand."
          : error.message.replace(/^error: /, "")
      printError(new Error(detail), true)
    }
    return 2
  }
}
