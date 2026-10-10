import { describe, expect, test, vi } from "vitest"

import { approvedMigrationsMatch } from "./migration-approval.server.ts"
import { bundledMigration, pendingDatabaseMigrations } from "./migration-log.server.ts"

describe("bundled migration history", () => {
  test("preserves existing SQL-only digests and skips applied migrations without loading scripts", () => {
    const load = vi.fn()
    const existing = bundledMigration("20261009120000_existing", "select 1;")
    const scripted = bundledMigration("20261009120100_scripted", "-- data migration", {
      source: "export async function up(client) { await client.query('select 1') }",
      load,
    })

    expect(existing.hash).toBe("354b7196c9ba5fb4b21cf615bb6ec4cd5c07503c34229feef033fc081a8c03f4")
    expect(pendingDatabaseMigrations([existing, scripted], [existing])).toEqual([scripted])
    expect(pendingDatabaseMigrations([existing, scripted], [existing, scripted])).toEqual([])
    expect(load).not.toHaveBeenCalled()
  })

  test("binds approval to both sources and rejects edited history or SQL-only execution", () => {
    const name = "20261009120200_transform"
    const sql = "-- data migration"
    const script = { source: "export async function up() {}", load: vi.fn() }
    const original = bundledMigration(name, sql, script)
    const changedScript = bundledMigration(name, sql, { ...script, source: script.source + "\n" })
    const changedSql = bundledMigration(name, sql + "\n", script)
    const sqlOnly = bundledMigration(name, sql)

    expect(approvedMigrationsMatch([original], [original])).toBe(true)
    for (const changed of [changedScript, changedSql, sqlOnly]) {
      expect(approvedMigrationsMatch([changed], [original])).toBe(false)
      expect(() => pendingDatabaseMigrations([original], [changed])).toThrow(name)
    }
    expect(script.load).not.toHaveBeenCalled()
  })
})
