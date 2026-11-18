import { appendFileSync, constants, copyFileSync, rmSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import process from "node:process"

import { sql } from "drizzle-orm"
import { loadEnv } from "vite"

import { createSeedDatabase, loadSeedEnvironment, resolveSeedDatabaseUrl } from "./seed/database.ts"

async function bootstrapWorktree(): Promise<void> {
  const platformDirectory = process.cwd()
  let worktreeDatabase: string | undefined

  if (process.argv.includes("--worktree")) {
    const workspaceDirectory = dirname(platformDirectory)
    const sourceRoot =
      process.env.ROOT_WORKTREE_PATH ||
      dirname((await Bun.$`git rev-parse --path-format=absolute --git-common-dir`.text()).trim())
    if (sourceRoot === workspaceDirectory)
      throw new Error("Worktree setup requires a linked checkout")
    worktreeDatabase = basename(
      basename(workspaceDirectory) === basename(sourceRoot)
        ? dirname(workspaceDirectory)
        : workspaceDirectory,
    )

    const databaseEnvFile = join(platformDirectory, ".env.development.local")
    const createDatabaseEnv = !(await Bun.file(databaseEnvFile).exists())
    for (const name of [".env.local", ".env.development.local"]) {
      const source = join(sourceRoot, "platform", name)
      const destination = join(platformDirectory, name)
      if ((await Bun.file(source).exists()) && !(await Bun.file(destination).exists()))
        copyFileSync(source, destination, constants.COPYFILE_EXCL)
    }
    if (createDatabaseEnv) {
      const url = new URL(loadEnv("development", platformDirectory, "").DATABASE_URL!)
      url.pathname = "/" + worktreeDatabase
      // Preserve literal dollar signs when dotenv expands the generated value.
      const value = JSON.stringify(url.href).replaceAll("$", "\\$")
      appendFileSync(databaseEnvFile, `\nDATABASE_URL=${value}\n`)
    }
  }

  loadSeedEnvironment()
  const { url, databaseName, host, port } = resolveSeedDatabaseUrl()
  if (worktreeDatabase) {
    if (databaseName !== worktreeDatabase)
      throw new Error("Refusing to initialize a database outside the current worktree")
    const adminUrl = new URL(url)
    adminUrl.pathname = "/postgres"
    const { pool, database } = createSeedDatabase(adminUrl.href)
    try {
      const { rows } = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
        databaseName,
      ])
      if (!rows.length) await database.execute(sql`CREATE DATABASE ${sql.identifier(databaseName)}`)
    } finally {
      await pool.end()
    }
  }

  const { pool } = createSeedDatabase(url)
  let databaseState: { oid: string; uninitialized: boolean }
  try {
    const { rows } = await pool.query<typeof databaseState>(
      "SELECT oid::text, to_regclass('public.organization') IS NULL AS uninitialized FROM pg_database WHERE datname = current_database()",
    )
    databaseState = rows[0]!
  } finally {
    await pool.end()
  }
  const seedTarget = Bun.CryptoHasher.hash(
    "sha256",
    JSON.stringify([host, port, databaseName, databaseState.oid]),
    "hex",
  )
  const pendingSeedPath = join(platformDirectory, ".data", `setup-seed-${seedTarget}.pending`)
  if (databaseState.uninitialized) await Bun.write(pendingSeedPath, "", { mode: 0o600 })
  await Bun.$`${process.execPath} run db migrate`.env(process.env)
  if (await Bun.file(pendingSeedPath).exists()) {
    await Bun.$`${process.execPath} run db-seed`.env(process.env)
    rmSync(pendingSeedPath, { force: true })
  }
  await Bun.$`${process.execPath} run --cwd ../sdk build`.env(process.env)
  await Bun.$`${process.execPath} run --cwd packages/sandbox build`.env(process.env)
}

await bootstrapWorktree()
