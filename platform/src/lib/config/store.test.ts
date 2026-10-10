import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Logger } from "effect"
import { afterAll, beforeAll, vi } from "vitest"

import type { EffectDatabase } from "@/db/database"
import { configTable } from "../../db/schema/config.ts"
import { readDatabaseConfig } from "./store.ts"

beforeAll(() => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "a".repeat(64))
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe("database configuration", () => {
  it.effect("fails closed for unreadable and mismatched encrypted values", () => {
    const lines: string[] = []
    const database = readDatabase(
      Effect.succeed([
        { key: "better_auth_secret", storedValue: "not-a-compact-jwe" },
        {
          key: "turnstile_secret_key",
          storedValue: encryptedValue("resend_api_key", "provider-secret"),
        },
      ]),
    )
    return Effect.gen(function* () {
      const state = yield* readDatabaseConfig(database)
      assert.deepStrictEqual(state.values, {})
      assert.deepStrictEqual(state.rows, [
        { key: "better_auth_secret", storageStatus: "unreadable" },
        { key: "turnstile_secret_key", storageStatus: "unreadable" },
      ])
      assert.isAbove(lines.length, 0)
      assert.notInclude(lines.join("\n"), "not-a-compact-jwe")
      assert.notInclude(lines.join("\n"), "provider-secret")
    }).pipe(
      Effect.provide(Logger.layer([Logger.map(Logger.formatJson, (line) => lines.push(line))])),
    )
  })

  it.effect("treats only a missing config table as an empty bootstrap state", () =>
    Effect.gen(function* () {
      const missingTable = Object.assign(new Error("missing table"), { code: "42P01" })
      const bootstrap = yield* readDatabaseConfig(readDatabase(Effect.fail(missingTable)))
      assert.deepStrictEqual(bootstrap, { rows: null, values: {} })

      const unavailable = Object.assign(new Error("database unavailable"), { code: "08006" })
      const exit = yield* Effect.exit(readDatabaseConfig(readDatabase(Effect.fail(unavailable))))
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
    }),
  )
})

function encryptedValue(key: string, value: string): string {
  return configTable.value.mapToDriverValue({ key, value }) as string
}

function readDatabase(rows: Effect.Effect<readonly unknown[], unknown>): EffectDatabase {
  const query = Object.assign(rows, { where: () => rows })
  return { select: () => ({ from: () => query }) } as unknown as EffectDatabase
}
