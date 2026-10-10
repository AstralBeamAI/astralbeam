import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { describe, expect, test, vi } from "vitest"

import {
  bundledMigration,
  executeMigration,
  pendingDatabaseMigrations,
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
  test("rolls back SQL and script writes on failure, then retries, commits and skips both steps", async () => {
    const pool = new Pool({ connectionString: migrationExecutionIntegration.url })
    const client = await pool.connect()
    const table = `migration_test_${randomUUID().replaceAll("-", "")}`
    let fail = true
    let calls = 0
    const transformation = bundledMigration(
      `20261009120300_${table}`,
      `create table ${table} (value text not null);
--> statement-breakpoint
insert into ${table} values ('sql');`,
      {
        source: "transactional transformation fixture",
        load: () =>
          Promise.resolve({
            up: async (transaction) => {
              calls++
              expect((await transaction.query(`select value from ${table}`)).rows).toEqual([
                { value: "sql" },
              ])
              await transaction.query(`update ${table} set value = 'typescript'`)
              if (fail) throw new Error("Transformation failed")
            },
          }),
      },
    )
    const constraint = bundledMigration(
      `20261009120400_${table}`,
      `alter table ${table} add check (value = 'typescript')`,
    )
    const migrations = [transformation, constraint]
    const names = migrations.map((migration) => migration.name)

    try {
      await client.query("begin")
      await expect(executeMigration(client, transformation)).rejects.toThrow(
        "Transformation failed",
      )
      await client.query("rollback")
      expect((await client.query("select to_regclass($1) as name", [table])).rows).toEqual([
        { name: null },
      ])
      expect(
        (
          await client.query("select name from drizzle.__drizzle_migrations where name = any($1)", [
            names,
          ])
        ).rows,
      ).toEqual([])

      fail = false
      await client.query("begin")
      for (const migration of migrations) await executeMigration(client, migration)
      await client.query("commit")
      expect((await pool.query(`select value from ${table}`)).rows).toEqual([
        { value: "typescript" },
      ])
      const applied = await pool.query<{ name: string; hash: string }>(
        "select name, hash from drizzle.__drizzle_migrations where name = any($1) order by name",
        [names],
      )
      expect(applied.rows).toEqual(migrations.map(({ name, hash }) => ({ name, hash })))
      for (const migration of pendingDatabaseMigrations(migrations, applied.rows)) {
        await executeMigration(client, migration)
      }
      expect(calls).toBe(2)
    } finally {
      await client.query("rollback")
      await client.query(`drop table if exists ${table}`)
      await client.query("delete from drizzle.__drizzle_migrations where name = any($1)", [names])
      client.release()
      await pool.end()
    }
  })
})
