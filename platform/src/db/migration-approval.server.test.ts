import { describe, expect, test } from "vitest"

import { approvedMigrationsMatch } from "./migration-approval.server.ts"
import { bundledMigration } from "./migration-log.server.ts"

function migration(name: string): Parameters<typeof approvedMigrationsMatch>[0][number] {
  return { name, hash: name }
}

describe("migration approval boundary", () => {
  test("changing credential conversion code invalidates approval even when SQL is unchanged", () => {
    const name = "20261001165317_migrate_organization_model_keys"
    const sql = "ALTER TABLE organization_configuration DROP COLUMN openai_api_key"
    const reviewed = bundledMigration(name, sql, "reviewed conversion")
    const changed = bundledMigration(name, sql, "different conversion")
    expect(approvedMigrationsMatch([changed], [reviewed])).toBe(false)
    expect(approvedMigrationsMatch([bundledMigration(name, sql)], [reviewed])).toBe(false)
  })
  test("approval binds the exact ordered names and SQL digests", () => {
    const pending = [migration("a"), migration("b")]
    expect(
      approvedMigrationsMatch(pending, [
        { name: "a", hash: "a" },
        { name: "b", hash: "b" },
      ]),
    ).toBe(true)
    expect(
      approvedMigrationsMatch(pending, [
        { name: "a", hash: "changed" },
        { name: "b", hash: "b" },
      ]),
    ).toBe(false)
    expect(
      approvedMigrationsMatch(pending, [
        { name: "b", hash: "b" },
        { name: "a", hash: "a" },
      ]),
    ).toBe(false)
  })
})
