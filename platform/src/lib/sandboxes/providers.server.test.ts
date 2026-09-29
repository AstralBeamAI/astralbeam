import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Result } from "effect"
import { vi } from "vitest"

import { Database, type EffectDatabase } from "@/db/database.server"
import { parseDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { encryptDatabaseValue } from "@/db/lib/encryption.server"
import { SandboxProviderCredentialsPayloadSchema } from "@/db/schema/organizations.server"
import { SandboxProviders } from "./providers.server.ts"

const ORGANIZATION_ID = "01992a80-1d71-7f24-a150-f1177e3f6419"
const SANDBOX_PROVIDER_ID = "01992a80-1d71-7f24-a150-f1177e3f6420"
const OTHER_PROVIDER_ID = "01992a80-1d71-7f24-a150-f1177e3f6421"

const TEST_ENCRYPTION_KEY = "sandbox-provider-test-key-not-for-deployment"
vi.stubEnv("DATABASE_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY)

const storedCredentials = Result.getOrThrow(
  encryptDatabaseValue({
    value: {
      sandboxProviderId: SANDBOX_PROVIDER_ID,
      organizationId: ORGANIZATION_ID,
      providerType: "daytona",
      credentials: { apiKey: "secret" },
    },
    schema: SandboxProviderCredentialsPayloadSchema,
    keyring: parseDatabaseEncryptionKeyring(TEST_ENCRYPTION_KEY),
  }),
)

function providersOver(row: { id: string; storedCredentials: string | null }) {
  const stored = {
    organizationId: ORGANIZATION_ID,
    name: "Primary Daytona",
    providerType: "daytona",
    options: { target: "us", snapshot: "daytona-medium" },
    lastTest: null,
    lockVersion: 0,
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
    updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    ...row,
  }
  const database = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Effect.succeed([stored]) }) }) }),
  } as unknown as EffectDatabase
  return SandboxProviders.layerNoDeps.pipe(Layer.provide(Layer.succeed(Database, database)))
}

const resolveConfiguration = (id: string) =>
  Effect.flatMap(SandboxProviders, (providers) =>
    providers.resolveConfiguration({ organizationId: ORGANIZATION_ID, id }),
  )

describe("SandboxProviders", () => {
  it.effect("reveals a row's own credentials and refuses credentials copied from another row", () =>
    Effect.gen(function* () {
      const own = yield* resolveConfiguration(SANDBOX_PROVIDER_ID).pipe(
        Effect.provide(providersOver({ id: SANDBOX_PROVIDER_ID, storedCredentials })),
      )
      assert.deepStrictEqual(own.credentials, { apiKey: "secret" })

      const copied = yield* resolveConfiguration(OTHER_PROVIDER_ID).pipe(
        Effect.flip,
        Effect.provide(providersOver({ id: OTHER_PROVIDER_ID, storedCredentials })),
      )
      assert.strictEqual(copied._tag, "SandboxProviderUnreadable")
    }),
  )

  it.effect("degrades unreadable credentials to an empty editable value", () =>
    Effect.gen(function* () {
      const providers = yield* SandboxProviders
      const provider = yield* providers.get({
        organizationId: ORGANIZATION_ID,
        id: SANDBOX_PROVIDER_ID,
      })
      assert.deepStrictEqual(provider?.credentials, {})
      assert.isFalse(provider?.credentialsReadable)
    }).pipe(
      Effect.provide(providersOver({ id: SANDBOX_PROVIDER_ID, storedCredentials: "not-a-jwe" })),
    ),
  )
})
