import { randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import { Pool } from "pg"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import {
  type BundledMigration,
  type MigrationClient,
  bundledMigration,
  runDatabaseMigrations,
} from "./migration-log.server.ts"

const migrationExecutionIntegration = vi.hoisted(() => {
  const configured = globalThis.process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test")) {
      throw new Error("Use a disposable loopback database ending in _test")
    }
  }
  return { url }
})

describe.skipIf(!migrationExecutionIntegration.url)("TypeScript migration transactions", () => {
  let pool: Pool
  let table: string
  let migrations: BundledMigration[]
  beforeEach(() => {
    pool = new Pool({ connectionString: migrationExecutionIntegration.url })
    table = `migration_test_${randomUUID().replaceAll("-", "")}`
    migrations = []
  })
  afterEach(async () => {
    await pool.query(`drop table if exists ${table}`)
    await pool.query(`drop type if exists ${table}_enum`)
    await pool.query("delete from drizzle.__drizzle_migrations where name = any($1)", [
      migrations.map(({ name }) => name),
    ])
    await pool.end()
  })

  test("commits enum additions separately, rolls back failed SQL and TypeScript, and retries only pending work", async () => {
    await pool.query(`create type ${table}_enum as enum ('sql')`)
    const fail = vi.fn().mockRejectedValue(null)
    const up = vi.fn(async (client: MigrationClient) => {
      expect((await client.query(`select value from ${table}`)).rows).toEqual([{ value: "sql" }])
      await expect(runDatabaseMigrations(pool, migrations)).rejects.toThrow("already in progress")
      await client.query(`update ${table} set value = 'typescript'`)
      await fail()
    })
    migrations = [
      bundledMigration(
        `20261009120300_${table}`,
        `alter type ${table}_enum add value 'typescript'`,
      ),
      bundledMigration(
        `20261009120400_${table}`,
        `create table ${table} (value ${table}_enum); insert into ${table} values ('sql')`,
        {
          source: "transactional transformation fixture",
          load: () => Promise.resolve({ up }),
        },
      ),
    ]
    const names = migrations.map(({ name }) => name)
    expect(await runDatabaseMigrations(pool, migrations, { dryRun: true })).toEqual(names)
    expect(up).not.toHaveBeenCalled()
    await expect(runDatabaseMigrations(pool, migrations, { approved: [] })).rejects.toThrow(
      "review them again",
    )
    await expect(runDatabaseMigrations(pool, migrations, { approved: migrations })).rejects.toThrow(
      `Migration '${names[1]}' failed: null`,
    )
    expect((await pool.query("select to_regclass($1) as name", [table])).rows).toEqual([
      { name: null },
    ])
    expect(await runDatabaseMigrations(pool, migrations, { dryRun: true })).toEqual([names[1]])
    await expect(runDatabaseMigrations(pool, migrations, { approved: migrations })).rejects.toThrow(
      "review them again",
    )
    fail.mockRejectedValueOnce("string failure")
    await expect(runDatabaseMigrations(pool, migrations)).rejects.toThrow("failed: string failure")
    fail.mockResolvedValue(undefined)
    expect(
      await runDatabaseMigrations(pool, migrations, { approved: migrations.slice(1) }),
    ).toEqual([names[1]])
    expect((await pool.query(`select value from ${table}`)).rows).toEqual([{ value: "typescript" }])
    expect(await runDatabaseMigrations(pool, migrations)).toEqual([])
    expect(up).toHaveBeenCalledTimes(3)
  })

  test("survives a checked-out connection dying during an asynchronous step without recording success", async () => {
    const up = vi.fn(async (client: MigrationClient) => {
      await client.query("set local idle_in_transaction_session_timeout = '100ms'")
      await setTimeout(500)
    })
    migrations = [
      bundledMigration(`20261009120500_${table}`, `create table ${table} (value text)`, {
        source: "connection loss fixture",
        load: () => Promise.resolve({ up }),
      }),
    ]
    await expect(runDatabaseMigrations(pool, migrations)).rejects.toThrow(
      `Migration '${migrations[0]!.name}' failed:`,
    )
    expect((await pool.query("select to_regclass($1) as name", [table])).rows).toEqual([
      { name: null },
    ])
    expect(await runDatabaseMigrations(pool, migrations, { dryRun: true })).toEqual([
      migrations[0]!.name,
    ])
    up.mockImplementation(async (client: MigrationClient) => {
      await client.query("select 1")
    })
    expect(await runDatabaseMigrations(pool, migrations)).toEqual([migrations[0]!.name])
  })
})
