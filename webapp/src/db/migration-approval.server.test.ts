import { describe, expect, test } from "vitest"

import { approvedMigrationsMatch } from "./migration-approval.server.ts"

function migration(name: string): Parameters<typeof approvedMigrationsMatch>[0][number] {
  return { name, hash: name }
}

describe("migration approval boundary", () => {
  test("approval binds the exact ordered names and SQL digests", () => {
    const pending = [migration("a"), migration("b")]
    expect(approvedMigrationsMatch(pending, [
      { name: "a", hash: "a" },
      { name: "b", hash: "b" },
    ])).toBe(true)
    expect(approvedMigrationsMatch(pending, [
      { name: "a", hash: "changed" },
      { name: "b", hash: "b" },
    ])).toBe(false)
    expect(approvedMigrationsMatch(pending, [
      { name: "b", hash: "b" },
      { name: "a", hash: "a" },
    ])).toBe(false)
  })
})
