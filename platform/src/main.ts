import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"

import { Command } from "commander"

import packageJson from "../package.json" with { type: "json" }
import { migrateDatabase } from "./db/migrate-command.server.ts"
import { APP_HANDLE, APP_RELEASES_REPOSITORY } from "./lib/constants.ts"

const CLI_HELP_FOOTER = `
Environment:
  DATABASE_URL             PostgreSQL connection URL (required)
  DATABASE_ENCRYPTION_KEY  keyring for encrypted settings (required by start)
  PORT                     port the server listens on (default 3000)

Missing database variables are prompted for once and saved to ~/.astralbeam/platform.json.`

const BOOTSTRAP_ENVIRONMENT_FILE = join(homedir(), ".astralbeam", "platform.json")

const BOOTSTRAP_PROMPTS = {
  DATABASE_URL: "PostgreSQL connection URL (DATABASE_URL):",
  DATABASE_ENCRYPTION_KEY:
    "Encryption keyring, 32+ characters per entry (DATABASE_ENCRYPTION_KEY):",
}

// Release asset suffixes keyed by `${process.platform}-${process.arch}`.
const RELEASE_TARGETS: Record<string, string> = {
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "macos-x86_64",
  "darwin-arm64": "macos-arm64",
  "win32-x64": "windows-x86_64.exe",
}

const BINARY_HOST = `${process.platform}-${process.arch}`
const RELEASE_TARGET = RELEASE_TARGETS[BINARY_HOST]
const VERSION_OUTPUT = `${APP_HANDLE}-platform ${packageJson.version} (${RELEASE_TARGET ?? BINARY_HOST})`

type BootstrapVariable = keyof typeof BOOTSTRAP_PROMPTS

// Fills unset variables from the saved file, prompts on a terminal for any still missing, and
// reports where each value came from.
function loadBootstrapEnvironment(names: BootstrapVariable[]): void {
  const saved = (
    existsSync(BOOTSTRAP_ENVIRONMENT_FILE)
      ? JSON.parse(readFileSync(BOOTSTRAP_ENVIRONMENT_FILE, "utf8"))
      : {}
  ) as Partial<Record<BootstrapVariable, string>>
  const missing = names.filter((name) => !process.env[name] && !saved[name])
  for (const name of missing) {
    const value = prompt(BOOTSTRAP_PROMPTS[name])?.trim()
    if (value) saved[name] = value
  }
  if (missing.some((name) => saved[name])) {
    mkdirSync(dirname(BOOTSTRAP_ENVIRONMENT_FILE), { recursive: true, mode: 0o700 })
    writeFileSync(BOOTSTRAP_ENVIRONMENT_FILE, `${JSON.stringify(saved, null, 2)}\n`, {
      mode: 0o600,
    })
    console.error(`Saved to ${BOOTSTRAP_ENVIRONMENT_FILE}`)
  }
  for (const name of names) {
    if (process.env[name]) {
      console.error(`Using ${name} from the environment`)
    } else if (saved[name]) {
      process.env[name] = saved[name]
      console.error(`Using ${name} from ${BOOTSTRAP_ENVIRONMENT_FILE}`)
    }
  }
}

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
  .version(VERSION_OUTPUT)
  .addHelpText("after", CLI_HELP_FOOTER)

program
  .command("start", { isDefault: true })
  .description("start the server (the default command)")
  .action(async () => {
    loadBootstrapEnvironment(["DATABASE_URL", "DATABASE_ENCRYPTION_KEY"])
    restoreRequestAbortSemantics()
    // Computed so typechecking needs no build output; `deno compile --include` embeds the module.
    await import(new URL("../.output/server/index.mjs", import.meta.url).href)
  })

program
  .command("version")
  .description("print the version")
  .action(() => console.log(VERSION_OUTPUT))

program
  .command("migrate")
  .description("apply pending database migrations in one transaction")
  .option("--dry-run", "list pending migrations without applying them")
  .action(async (options: { dryRun?: boolean }) => {
    loadBootstrapEnvironment(["DATABASE_URL"])
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

program
  .command("upgrade")
  .description("replace this binary with the latest release or the given one")
  .argument("[version]", "release tag such as v0.13.1 (default: the latest release)")
  .option("-y, --yes", "replace the binary without asking for confirmation")
  .action(async (requested: string | undefined, options: { yes?: boolean }) => {
    const binaryPath = process.execPath
    try {
      // Under `deno run`, `execPath` is Deno itself. https://docs.deno.com/api/deno/~/Deno.build
      const { Deno: deno } = globalThis as unknown as { Deno: { build: { standalone: boolean } } }
      if (!deno.build.standalone) {
        throw new Error(
          "upgrade replaces a compiled binary, so pull and rebuild a checkout instead",
        )
      }
      if (!RELEASE_TARGET) throw new Error(`no release binary for ${BINARY_HOST}`)
      let tag = requested
      if (!tag) {
        const response = await fetch(
          `https://api.github.com/repos/${APP_RELEASES_REPOSITORY}/releases/latest`,
        )
        if (!response.ok) throw new Error(`latest release lookup returned HTTP ${response.status}`)
        tag = ((await response.json()) as { tag_name: string }).tag_name
      }
      const version = tag.replace(/^v/, "")
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`${tag} is not a release tag such as v0.13.1`)
      }
      if (version === packageJson.version) return console.log(`Already at ${version}`)
      // Earlier releases put the version in each asset name.
      if (version.localeCompare("0.13.0", undefined, { numeric: true }) < 0) {
        throw new Error("upgrade supports v0.13.0 and later releases")
      }
      if (version.localeCompare(packageJson.version, undefined, { numeric: true }) < 0) {
        console.error(`Warning: downgrading to ${version} does not undo applied migrations`)
      }
      if (
        !options.yes &&
        !confirm(`Replace ${packageJson.version} with ${version} at ${binaryPath}?`)
      ) {
        throw new Error("upgrade cancelled")
      }
      const asset = `${APP_HANDLE}-platform-${RELEASE_TARGET}`
      const response = await fetch(
        `https://github.com/${APP_RELEASES_REPOSITORY}/releases/download/v${version}/${asset}`,
      )
      if (!response.ok) {
        throw new Error(`downloading v${version} ${asset} returned HTTP ${response.status}`)
      }
      const downloadPath = `${binaryPath}.download`
      try {
        writeFileSync(downloadPath, new Uint8Array(await response.arrayBuffer()))
        chmodSync(downloadPath, 0o755)
        // Windows cannot overwrite a running executable, but it can rename one.
        if (process.platform === "win32") renameSync(binaryPath, `${binaryPath}.old`)
        renameSync(downloadPath, binaryPath)
      } finally {
        rmSync(downloadPath, { force: true })
      }
      console.log(`Replaced ${packageJson.version} with ${version}`)
      console.log(`Run \`${program.name()} migrate\`, then restart the service`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "EACCES" || code === "EPERM") {
        program.error(
          `error: cannot replace ${binaryPath}, rerun with write access to it, such as with sudo`,
        )
      }
      program.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

await program.parseAsync(process.argv)
