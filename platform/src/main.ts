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

// The `Deno.serve(options, handler)` form srvx calls. https://docs.deno.com/api/deno/~/Deno.serve
type DenoServe = (
  options: object,
  handler: (request: Request, info: { completed: Promise<void> }) => Response | Promise<Response>,
) => unknown

// Compiled binaries ignore `no-legacy-abort`, so their request signals also abort once a response
// is delivered. https://github.com/denoland/deno/blob/v2.9.7/cli/rt/run.rs#L1786
function restoreRequestAbortSemantics(): void {
  const { Deno: deno } = globalThis as unknown as { Deno: { serve: DenoServe } }
  const serve = deno.serve
  deno.serve = (options, handler) =>
    serve(options, (request, info) => {
      const abort = new AbortController()
      let delivered = false
      void info.completed.then(
        () => (delivered = true),
        () => abort.abort(),
      )
      // A delivered response resolves `completed` just before the legacy abort fires.
      request.signal.addEventListener("abort", () =>
        queueMicrotask(() => {
          if (!delivered) abort.abort()
        }),
      )
      return handler(new Request(request, { signal: abort.signal }), info)
    })
  // Reading the legacy signal above triggers Deno's notice, which the replacement signal makes false.
  const { warn } = console
  console.warn = (...data: unknown[]) => {
    if (!String(data[0]).startsWith("Deno.serve: request.signal aborts")) warn(...data)
  }
}

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
    restoreRequestAbortSemantics()
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
