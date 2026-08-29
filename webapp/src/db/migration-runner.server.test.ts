import type postgres from "postgres"
import { describe, expect, test, vi } from "vitest"

import { runWithMigrationAdvisoryLock } from "./migration-runner.server.ts"

function lockClient(locked: boolean): {
  client: postgres.Sql
  transaction: ReturnType<typeof vi.fn>
} {
  const transaction = vi.fn((_template: TemplateStringsArray) => Promise.resolve([{ locked }]))
  const client = {
    begin: vi.fn(async (callback) =>
      await callback(transaction as unknown as postgres.TransactionSql)
    ),
  } as unknown as postgres.Sql
  return { client, transaction }
}

describe("migration advisory lock", () => {
  test("runs migrations while the transaction-scoped lock is held", async () => {
    const applyMigrations = vi.fn(() =>
      Promise.resolve({ ok: true as const, applied: ["migration"] })
    )
    const locking = lockClient(true)

    await expect(runWithMigrationAdvisoryLock(locking.client, applyMigrations)).resolves.toEqual({
      ok: true,
      applied: ["migration"],
    })
    const lockQuery = locking.transaction.mock.calls.at(0)?.at(0)
    if (!lockQuery) throw new Error("Expected an advisory-lock query")
    expect(lockQuery.join("?")).toContain("pg_try_advisory_xact_lock")
    expect(applyMigrations).toHaveBeenCalledOnce()
  })

  test("rejects a competing migration run", async () => {
    const applyMigrations = vi.fn(() => Promise.resolve({ ok: true as const, applied: [] }))

    await expect(
      runWithMigrationAdvisoryLock(lockClient(false).client, applyMigrations),
    ).resolves.toEqual({
      ok: false,
      error: "A migration run is already in progress",
    })
    expect(applyMigrations).not.toHaveBeenCalled()
  })
})
