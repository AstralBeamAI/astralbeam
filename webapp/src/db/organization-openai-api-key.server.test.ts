import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { afterAll, beforeAll, vi } from "vitest"

import { type EffectDatabase, effectDatabase } from "@/db"
import { readOrganizationOpenaiApiKey } from "./organization-openai-api-key.server.ts"
import { organizationConfiguration } from "./schema/organizations.server.ts"

const ORGANIZATION_ID = "01990a5d-0000-7000-8000-000000000011"
const OTHER_ORGANIZATION_ID = "01990a5d-0000-7000-8000-000000000012"
const TEST_API_KEY = `sk-${"a".repeat(32)}`

beforeAll(() => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "a".repeat(64))
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe("organization OpenAI API key", () => {
  it.effect("reveals the organization's own key and nothing when none is stored", () =>
    Effect.gen(function* () {
      const stored = yield* readOrganizationOpenaiApiKey(ORGANIZATION_ID).pipe(
        Effect.provide(Layer.succeed(
          effectDatabase,
          configurationDatabase([{
            organizationId: ORGANIZATION_ID,
            openaiApiKey: storedApiKey(ORGANIZATION_ID),
          }]),
        )),
      )
      assert.strictEqual(stored, TEST_API_KEY)

      const missing = yield* readOrganizationOpenaiApiKey(ORGANIZATION_ID).pipe(
        Effect.provide(Layer.succeed(
          effectDatabase,
          configurationDatabase([{ organizationId: ORGANIZATION_ID, openaiApiKey: null }]),
        )),
      )
      assert.strictEqual(missing, null)
    }))

  it.effect("refuses a key encrypted for another organization", () =>
    Effect.gen(function* () {
      const error = yield* readOrganizationOpenaiApiKey(ORGANIZATION_ID).pipe(
        Effect.provide(Layer.succeed(
          effectDatabase,
          // The row is this organization's, the ciphertext in it is not.
          configurationDatabase([{
            organizationId: ORGANIZATION_ID,
            openaiApiKey: storedApiKey(OTHER_ORGANIZATION_ID),
          }]),
        )),
        Effect.flip,
      )
      assert.strictEqual(error._tag, "OrganizationOpenaiApiKeyError")
    }))
})

type ConfigurationRow = {
  readonly organizationId: string
  readonly openaiApiKey: { organizationId: string; apiKey: string } | null
}

/** Round-trips the payload through the encrypted column, the way a real read would. */
function storedApiKey(organizationId: string): NonNullable<ConfigurationRow["openaiApiKey"]> {
  const column = organizationConfiguration.openaiApiKey
  const ciphertext: unknown = column.mapToDriverValue({ organizationId, apiKey: TEST_API_KEY })
  if (typeof ciphertext !== "string") throw new Error("Expected an encrypted OpenAI API key")
  const payload: unknown = column.mapFromDriverValue(ciphertext)
  return payload as NonNullable<ConfigurationRow["openaiApiKey"]>
}

function configurationDatabase(rows: readonly ConfigurationRow[]): EffectDatabase {
  const result = Effect.succeed(rows)
  const query = Object.assign(result, { where: () => query, limit: () => result })
  return { select: () => ({ from: () => query }) } as unknown as EffectDatabase
}
