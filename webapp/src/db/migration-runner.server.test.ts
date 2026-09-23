import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, test, vi } from "vitest"

import { runWithMigrationAdvisoryLock } from "./migration-runner.server.ts"

function lockClient(locked: boolean) {
  const execute = vi.fn((_query: SQL) => Promise.resolve({ rows: [{ locked }] }))
  const database = {
    transaction: (callback: (transaction: { execute: typeof execute }) => Promise<unknown>) =>
      callback({ execute }),
  } as unknown as Parameters<typeof runWithMigrationAdvisoryLock>[0]
  return { database, execute }
}

describe("migration advisory lock", () => {
  test("runs migrations while the transaction-scoped lock is held", async () => {
    const applyMigrations = vi.fn(() =>
      Promise.resolve({ ok: true as const, applied: ["migration"] }),
    )
    const locking = lockClient(true)

    await expect(runWithMigrationAdvisoryLock(locking.database, applyMigrations)).resolves.toEqual({
      ok: true,
      applied: ["migration"],
    })
    const lockQuery = locking.execute.mock.calls.at(0)?.at(0)
    if (!lockQuery) throw new Error("Expected an advisory-lock query")
    expect(new PgDialect().sqlToQuery(lockQuery).sql).toContain("pg_try_advisory_xact_lock")
    expect(applyMigrations).toHaveBeenCalledOnce()
  })

  test("rejects a competing migration run", async () => {
    const applyMigrations = vi.fn(() => Promise.resolve({ ok: true as const, applied: [] }))

    await expect(
      runWithMigrationAdvisoryLock(lockClient(false).database, applyMigrations),
    ).resolves.toEqual({
      ok: false,
      error: "A migration run is already in progress",
    })
    expect(applyMigrations).not.toHaveBeenCalled()
  })
})
