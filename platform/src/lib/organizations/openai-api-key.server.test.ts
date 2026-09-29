import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { afterAll, beforeAll, vi } from "vitest"

import { type EffectDatabase, Database } from "@/db/database.server"
import { readOrganizationOpenaiApiKey } from "./openai-api-key.server.ts"
import { organizationConfiguration } from "../../db/schema/organizations.server.ts"

const ORGANIZATION_ID = "01990a5d-0000-7000-8000-000000000011"
const OTHER_ORGANIZATION_ID = "01990a5d-0000-7000-8000-000000000012"
const TEST_API_KEY = `sk-${"a".repeat(32)}`

beforeAll(() => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "a".repeat(64))
})

afterAll(() => {
  vi.unstubAllEnvs()
})

/** Answers the read with one row holding `storedValue`, the column's raw ciphertext. */
function readKey(storedValue: string | null) {
  const result = Effect.succeed([{ organizationId: ORGANIZATION_ID, storedValue }])
  const query = Object.assign(result, { where: () => query, limit: () => result })
  const database = { select: () => ({ from: () => query }) } as unknown as EffectDatabase
  return readOrganizationOpenaiApiKey(ORGANIZATION_ID).pipe(
    Effect.provide(Layer.succeed(Database, database)),
  )
}

function ciphertext(organizationId: string): string {
  return organizationConfiguration.openaiApiKey.mapToDriverValue({
    organizationId,
    apiKey: TEST_API_KEY,
  }) as string
}

describe("organization OpenAI API key", () => {
  it.effect("reveals the organization's own key and nothing when none is stored", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* readKey(ciphertext(ORGANIZATION_ID)), TEST_API_KEY)
      assert.strictEqual(yield* readKey(null), null)
    }),
  )

  it.effect("refuses a key encrypted for another organization or not decryptable", () =>
    Effect.gen(function* () {
      for (const storedValue of [ciphertext(OTHER_ORGANIZATION_ID), "not-a-compact-jwe"]) {
        const error = yield* Effect.flip(readKey(storedValue))
        assert.strictEqual(error._tag, "OrganizationOpenaiApiKeyUnreadable")
      }
    }),
  )
})
