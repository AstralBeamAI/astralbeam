import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import type { Pool, PoolClient } from "pg"

import { MigrationsNotApplied, withMigrationLock } from "./migration-runner.server.ts"

function lockPool(locked: boolean) {
  const queries: string[] = []
  const client = {
    query: (text: string) => {
      queries.push(text)
      return Promise.resolve({ rows: [{ locked }] })
    },
    release: () => queries.push("release"),
  } as unknown as PoolClient
  const pool: Pick<Pool, "connect"> = { connect: () => Promise.resolve(client) }
  return { pool, queries }
}

describe("migration advisory lock", () => {
  it("finishes an asynchronous migration before releasing its client after interruption", async () => {
    const { pool, queries } = lockPool(true)
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const controller = new AbortController()
    const execution = Effect.runPromiseExit(
      withMigrationLock(
        pool,
        Effect.promise(async () => {
          queries.push("apply-start")
          started.resolve()
          await finish.promise
          queries.push("apply-end")
        }),
      ),
      { signal: controller.signal },
    )
    await started.promise
    controller.abort()
    const duringInterruption = [...queries]
    finish.resolve()
    await execution
    assert.notInclude(duringInterruption, "rollback")
    assert.notInclude(duringInterruption, "release")
    assert.deepStrictEqual(queries.slice(2), ["apply-start", "apply-end", "commit", "release"])
  })

  it.effect("runs migrations while the transaction-scoped lock is held", () =>
    Effect.gen(function* () {
      const { pool, queries } = lockPool(true)
      const applied = yield* withMigrationLock(
        pool,
        Effect.sync(() => queries.push("apply")),
      )
      assert.isNumber(applied)
      assert.strictEqual(queries[0], "begin")
      assert.include(queries[1], "pg_try_advisory_xact_lock")
      assert.deepStrictEqual(queries.slice(2), ["apply", "commit", "release"])
    }),
  )

  it.effect("rejects a competing migration run and releases its client", () =>
    Effect.gen(function* () {
      const { pool, queries } = lockPool(false)
      const failure = yield* Effect.flip(
        withMigrationLock(
          pool,
          Effect.sync(() => queries.push("apply")),
        ),
      )
      assert.deepStrictEqual(
        failure,
        new MigrationsNotApplied({ message: "A migration run is already in progress" }),
      )
      assert.notInclude(queries, "apply")
      assert.deepStrictEqual(queries.slice(-2), ["rollback", "release"])
    }),
  )
})
