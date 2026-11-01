import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"

const migrationHistory = vi.hoisted(() => ({ rows: [] as { name: string }[] }))
vi.mock("./database.ts", () => ({
  getAuthDatabase: () => ({
    $client: { query: () => Promise.resolve({ rows: migrationHistory.rows }) },
  }),
}))

import { DatabaseMigrations } from "./migration-runner.ts"

it.effect("opens the setup gate after a peer applies migrations", () =>
  Effect.gen(function* () {
    const migrations = yield* DatabaseMigrations
    const pending = yield* migrations.state
    assert.isAbove(pending.pending.length, 0)
    migrationHistory.rows = pending.pending.map(({ name }) => ({ name }))
    assert.strictEqual(yield* migrations.state, pending)
    yield* TestClock.adjust("5 seconds")
    const refreshed = yield* migrations.state
    assert.deepStrictEqual(refreshed.pending, [])
    assert.strictEqual(refreshed.appliedCount, pending.pending.length)
  }).pipe(Effect.provide(DatabaseMigrations.layer)),
)
