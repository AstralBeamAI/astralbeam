import { describe, expect, test } from "vitest"

import { approvedNamesMatch, type BundledMigration, pendingMigrations } from "./migrations.server"

function migration(name: string): BundledMigration {
  return { name, sql: "select 1", hash: name, folderMillis: 0 }
}

describe("migration approval boundary", () => {
  test("every bundled migration is pending when bookkeeping is missing", () => {
    const bundled = [migration("20260824082410_first"), migration("20260825121722_second")]
    expect(pendingMigrations(bundled, null)).toEqual(bundled)
  })

  test("applied migrations are matched by name", () => {
    const bundled = [migration("20260824082410_first"), migration("20260825121722_second")]
    expect(pendingMigrations(bundled, new Set(["20260824082410_first"]))).toEqual([
      migration("20260825121722_second"),
    ])
    expect(pendingMigrations(bundled, new Set(bundled.map((entry) => entry.name)))).toEqual([])
  })

  test("only the exact reviewed migration list is approved", () => {
    expect(approvedNamesMatch(["a", "b"], ["a", "b"])).toBe(true)
    expect(approvedNamesMatch(["a", "b"], ["b", "a"])).toBe(false)
    expect(approvedNamesMatch(["a", "b"], ["a"])).toBe(false)
    expect(approvedNamesMatch(["a"], ["a", "b"])).toBe(false)
  })
})
