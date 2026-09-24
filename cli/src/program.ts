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
  // exitOverride precedes the subcommands so each inherits it and throws instead of exiting.
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
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2
    printError(error, program.opts<{ json?: boolean }>().json === true)
    return 1
  }
}
