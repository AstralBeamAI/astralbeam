import { readFileSync } from "node:fs"
import { expect, test, vi } from "vitest"

import { bundledMigration, pendingDatabaseMigrations } from "./migration-log.server.ts"

test("accepts only the released conversion digest for its unchanged SQL", () => {
  const name = "20261001165317_migrate_organization_model_keys"
  const sql = readFileSync(new URL(`migrations/${name}/migration.sql`, import.meta.url), "utf8")
  const migration = bundledMigration(name, sql)
  const history = [
    { name, hash: "0725692a5954f98fdc993833a1e53897a5a619eecda95b7b5fca6fac79f1922a" },
  ]
  expect(pendingDatabaseMigrations([migration], history)).toEqual([])
  for (const changed of [
    bundledMigration(name, sql + "\n"),
    bundledMigration(name, sql, { source: "export async function up() {}", load: vi.fn() }),
    { ...migration, name: "20261009120000_other" },
  ]) {
    expect(() =>
      pendingDatabaseMigrations([changed], [{ ...history[0]!, name: changed.name }]),
    ).toThrow("differs")
  }
  expect(() => pendingDatabaseMigrations([migration], [{ name, hash: "unknown" }])).toThrow(
    "differs",
  )
})
