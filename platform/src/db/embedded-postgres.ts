import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { link, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import { createInterface } from "node:readline"

import * as Schema from "effect/Schema"

import manifest from "./embedded-postgres.json" with { type: "json" }

const embeddedCredentialsSchema = Schema.Struct({
  password: Schema.String.check(Schema.isMinLength(32)),
  encryptionKey: Schema.optional(Schema.String.check(Schema.isMinLength(32))),
})
const embeddedProtocolSchema = Schema.Struct({
  protocol: Schema.Literal(1),
  event: Schema.Literals(["ready", "stopped", "error"]),
  connection_url: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

type EmbeddedPostgresOwner = {
  child: ChildProcessWithoutNullStreams
  exited: Promise<void>
  stopped: boolean
  ready: boolean
  closing?: Promise<void>
}
const embeddedPostgresKey = Symbol.for("platform.embeddedPostgres")
const embeddedPostgresProcess = globalThis as typeof globalThis & {
  [embeddedPostgresKey]?: EmbeddedPostgresOwner
}

async function readEmbeddedCredentials(directory: string) {
  const path = join(directory, "embedded-postgres.json")
  if (!existsSync(path)) {
    if (existsSync(join(directory, "postgres", "PG_VERSION"))) {
      throw new Error(`Restore the missing database credentials at ${path}`)
    }
    const temporary = `${path}.${randomUUID()}`
    try {
      await using file = await open(temporary, "wx", 0o600)
      await file.writeFile(
        JSON.stringify({
          password: randomBytes(32).toString("base64url"),
          ...(process.env.DATABASE_ENCRYPTION_KEY === undefined
            ? { encryptionKey: randomBytes(32).toString("base64url") }
            : {}),
        }),
      )
      await file.sync()
      // Publish a complete secret file without overwriting a concurrent first start's credentials.
      await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
      })
      if (process.platform !== "win32") {
        await using parent = await open(directory, "r")
        await parent.sync()
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }
  try {
    return Schema.decodeUnknownSync(embeddedCredentialsSchema)(
      JSON.parse(await readFile(path, "utf8")),
    )
  } catch {
    throw new Error(`Restore valid database credentials at ${path}`)
  }
}

async function downloadEmbeddedPostgresWrapper(directory: string): Promise<string> {
  const target = `${process.platform}-${process.arch}` as keyof typeof manifest.targets
  const assets = manifest.targets[target]
  if (!assets) throw new Error(`Embedded PostgreSQL is unavailable on ${target}. Set DATABASE_URL.`)
  const installation = join(directory, `runtime-${manifest.wrapperVersion}-${target}`)
  const wrapper = join(installation, assets.wrapper)
  if (!existsSync(installation)) {
    console.error("Downloading embedded PostgreSQL supervisor")
    const staging = await mkdtemp(join(directory, "runtime-"))
    try {
      const response = await fetch(
        `https://github.com/fergusstrange/embedded-postgres/releases/download/v${manifest.wrapperVersion}/${assets.wrapper}`,
        { signal: AbortSignal.timeout(120_000) },
      )
      if (!response.ok)
        throw new Error(`PostgreSQL supervisor download returned HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (createHash("sha256").update(bytes).digest("hex") !== assets.wrapperSha256) {
        throw new Error("PostgreSQL supervisor download failed SHA256 verification")
      }
      await writeFile(join(staging, assets.wrapper), bytes, { mode: 0o700, flag: "wx" })
      await rename(staging, installation).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error
      })
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  return wrapper
}

export async function startEmbeddedPostgres(options: { directory: string }): Promise<void> {
  if (embeddedPostgresProcess[embeddedPostgresKey])
    throw new Error("Embedded PostgreSQL is already owned by this process")
  if (process.getuid?.() === 0)
    throw new Error(
      "Run embedded PostgreSQL without sudo, or set DATABASE_URL for an external database",
    )
  await mkdir(options.directory, { recursive: true, mode: 0o700 })
  const credentials = await readEmbeddedCredentials(options.directory)
  if (credentials.encryptionKey) process.env.DATABASE_ENCRYPTION_KEY ??= credentials.encryptionKey
  if (process.env.DATABASE_ENCRYPTION_KEY === undefined) {
    throw new Error(
      "Restore DATABASE_ENCRYPTION_KEY in the environment before starting this database",
    )
  }
  const wrapper = await downloadEmbeddedPostgresWrapper(options.directory)
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("EP_")),
    ),
    EP_PASSWORD: credentials.password,
  }
  console.error("Preparing embedded PostgreSQL (downloads on first use)")
  const child = spawn(
    wrapper,
    [
      "run",
      "--json",
      "--parent-stdin",
      "--cache-dir",
      join(options.directory, "postgres-cache"),
      "--postgres-version",
      manifest.postgresVersion,
      "--data-dir",
      join(options.directory, "postgres"),
      "--database",
      "astralbeam",
      "--username",
      "astralbeam",
      "--start-timeout",
      "2m",
      "--stop-timeout",
      "5s",
    ],
    {
      // Keep terminal signals with AstralBeam so its existing handler can drain HTTP and SQL first.
      detached: process.platform !== "win32",
      windowsHide: true,
      env: environment,
      stdio: "pipe",
    },
  )
  child.stdin.on("error", () => {
    /* Exit and protocol events report owner failure. */
  })
  child.stderr.resume()
  const owner: EmbeddedPostgresOwner = {
    child,
    exited: once(child, "close").then(
      () => undefined,
      () => undefined,
    ),
    stopped: false,
    ready: false,
  }
  embeddedPostgresProcess[embeddedPostgresKey] = owner
  const ready = Promise.withResolvers<void>()
  const fail = (detail = "Check permissions, free disk space, and native runtime requirements") =>
    ready.reject(
      new Error(
        `Embedded PostgreSQL failed to start: ${detail.replaceAll(credentials.password, "[redacted]")}`,
      ),
    )
  child.once("error", () => fail())
  child.once("close", () => {
    fail()
    if (owner.ready && !owner.closing) {
      console.error("Embedded PostgreSQL exited unexpectedly")
      process.kill(process.pid, "SIGTERM")
    }
  })
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const event = Schema.decodeUnknownSync(embeddedProtocolSchema)(JSON.parse(line))
      if (event.event === "ready" && event.connection_url) {
        process.env.DATABASE_URL = event.connection_url
        owner.ready = true
        ready.resolve()
      } else if (event.event === "stopped") owner.stopped = true
      else fail(event.error)
    } catch {
      fail()
    }
  })
  const timer = setTimeout(
    () => ready.reject(new Error("Embedded PostgreSQL startup timed out")),
    125_000,
  )
  try {
    await ready.promise
  } finally {
    clearTimeout(timer)
  }
  console.error(`Using embedded PostgreSQL in ${options.directory}`)
}

export function stopEmbeddedPostgres(): Promise<void> {
  const owner = embeddedPostgresProcess[embeddedPostgresKey]
  if (!owner) return Promise.resolve()
  return (owner.closing ??= closeEmbeddedPostgresOwner(owner))
}

async function closeEmbeddedPostgresOwner(owner: EmbeddedPostgresOwner): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    owner.child.stdin.end()
    // Protocol 1 requires waiting for stopped and exit, with an outer deadline above stop_timeout + 2s.
    // https://github.com/fergusstrange/embedded-postgres/blob/v2.0.1/docs/cli.md
    await Promise.race([
      owner.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          owner.child.kill("SIGKILL")
          reject(new Error("Embedded PostgreSQL shutdown timed out"))
        }, 8_000)
      }),
    ])
    if (!owner.stopped || owner.child.exitCode !== 0) {
      throw new Error("Embedded PostgreSQL did not confirm a clean shutdown")
    }
  } finally {
    clearTimeout(timer)
  }
}
