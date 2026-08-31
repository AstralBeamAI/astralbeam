import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { afterAll, beforeAll, vi } from "vitest"

import { getDatabaseConfigEffect } from "./config.server.ts"
import { type EffectDatabase, effectDatabase } from "@/db"
import { configTable } from "./schema/config.server.ts"

const ACTIVE_KEY = "a".repeat(64)

beforeAll(() => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", ACTIVE_KEY)
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe("database configuration", () => {
  it.effect("fails closed for unreadable and mismatched encrypted values", () => {
    const database = readDatabase([
      { key: "better_auth_secret", storedValue: "not-a-compact-jwe" },
      {
        key: "turnstile_secret_key",
        storedValue: encryptedRow("openai_api_key", "provider-secret").storedValue,
      },
    ])
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})

    return Effect.gen(function* () {
      const state = yield* getDatabaseConfigEffect()

      assert.strictEqual(state.values.better_auth_secret, undefined)
      assert.strictEqual(state.values.turnstile_secret_key, undefined)
      assert.deepStrictEqual(state.rows, [
        { key: "better_auth_secret", storageStatus: "unreadable" },
        { key: "turnstile_secret_key", storageStatus: "unreadable" },
      ])
      assert(logged.mock.calls.length > 0)
      const loggedOutput = JSON.stringify(logged.mock.calls)
      assert(!loggedOutput.includes("not-a-compact-jwe"))
      assert(!loggedOutput.includes("provider-secret"))
    }).pipe(
      Effect.ensuring(Effect.sync(() => logged.mockRestore())),
      Effect.provide(Layer.succeed(effectDatabase, database)),
    )
  })

  it.effect("treats only a missing config table as an empty bootstrap state", () => {
    const missingTable = Object.assign(new Error("missing table"), { code: "42P01" })
    const unavailable = Object.assign(new Error("database unavailable"), { code: "08006" })

    return Effect.gen(function* () {
      const state = yield* getDatabaseConfigEffect().pipe(
        Effect.provide(Layer.succeed(effectDatabase, readDatabase(Effect.fail(missingTable)))),
      )
      assert.strictEqual(state.rows, null)
      assert.deepStrictEqual(state.values, {})

      const error = yield* getDatabaseConfigEffect().pipe(
        Effect.provide(Layer.succeed(effectDatabase, readDatabase(Effect.fail(unavailable)))),
        Effect.flip,
      )
      assert.strictEqual<unknown>(error, unavailable)
    })
  })
})

type StoredRow = {
  readonly key: string
  readonly storedValue: string
}

function encryptedRow(key: string, value: string): StoredRow {
  const storedValue: unknown = configTable.value.mapToDriverValue({ key, value })
  if (typeof storedValue !== "string") throw new Error("Expected an encrypted config value")
  return { key, storedValue }
}

function readDatabase(
  rows: readonly StoredRow[] | Effect.Effect<readonly StoredRow[], unknown>,
): EffectDatabase {
  const result = Effect.isEffect(rows) ? rows : Effect.succeed(rows)
  const query = Object.assign(result, { where: () => result })
  return {
    select: () => ({ from: () => query }),
  } as unknown as EffectDatabase
}
