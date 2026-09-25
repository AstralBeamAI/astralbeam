import process from "node:process"

import { Command } from "commander"

import packageJson from "../package.json" with { type: "json" }
import { migrateDatabase } from "./db/migrate-command.server.ts"
import { APP_HANDLE } from "./lib/constants.ts"

const CLI_HELP_FOOTER = `
Environment:
  DATABASE_URL             PostgreSQL connection URL (required)
  DATABASE_ENCRYPTION_KEY  keyring for encrypted settings (required by start)
  PORT                     port the server listens on (default 3000)`

function pluralMigrations(count: number): string {
  return `${count} migration${count === 1 ? "" : "s"}`
}

const program = new Command(`${APP_HANDLE}-platform`)
  .description("Run the platform server and its maintenance commands.")
  .version(packageJson.version)
  .addHelpText("after", CLI_HELP_FOOTER)

program
  .command("start", { isDefault: true })
  .description("start the server (the default command)")
  .action(async () => {
    // Computed so typechecking needs no build output; `deno compile --include` embeds the module.
    await import(new URL("../.output/server/index.mjs", import.meta.url).href)
  })

program
  .command("version")
  .description("print the version")
  .action(() => console.log(packageJson.version))

program
  .command("migrate")
  .description("apply pending database migrations in one transaction")
  .option("--dry-run", "list pending migrations without applying them")
  .action(async (options: { dryRun?: boolean }) => {
    const dryRun = options.dryRun ?? false
    try {
      const names = await migrateDatabase({ dryRun })
      if (names.length === 0) return console.log("No pending migrations")
      console.log(`${dryRun ? "Pending" : "Applied"} ${pluralMigrations(names.length)}:`)
      for (const name of names) console.log(`  ${name}`)
    } catch (error) {
      program.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

await program.parseAsync(process.argv)
