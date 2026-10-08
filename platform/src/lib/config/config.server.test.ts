import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Result } from "effect"
import { afterEach, beforeAll, beforeEach, vi } from "vitest"

import { Database, type EffectDatabase } from "@/db/database.server"
import { DatabaseMigrations } from "@/db/migration-runner.server"
import { configTable } from "@/db/schema/config.server"
import { Config, publicConfigFromValues } from "./config.server.ts"
import {
  CONFIG_DEFINITIONS,
  configEnvironmentVariable,
  decodeConfigValue,
  findConfigDefinition,
  validateConfigCompleteness,
} from "./registry.server.ts"
import type { ConfigValues } from "./types.ts"

const migrations = { pending: false }

const SECRET = "a".repeat(64)
const COMPLETE_VALUES = {
  dogfood_organization_id: "01990a5d-0000-7000-8000-000000000013",
  dogfood_api_key: `key_01990a5d-0000-7000-8000-000000000013_01990a5d-0000-7000-8000-000000000024_abo_${"A".repeat(64)}`,
  app_base_url: "http://localhost:3000",
  better_auth_secret: SECRET,
  turnstile_site_key: "turnstile-site-key",
  turnstile_secret_key: "turnstile-secret-key",
  support_email_address: "support@example.com",
  s3_endpoint: "http://127.0.0.1:9000",
  s3_region: "us-east-1",
  s3_bucket: "test-files",
  s3_access_key_id: "test-access-key",
  s3_secret_access_key: "test-secret-key",
} satisfies ConfigValues

type StoredRow = { readonly key: string; readonly storedValue: string }

beforeAll(() => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", SECRET)
})

beforeEach(() => {
  migrations.pending = false
  // A developer's own shell must not leak into what the tests expect.
  for (const definition of CONFIG_DEFINITIONS) {
    vi.stubEnv(configEnvironmentVariable(definition.key), "")
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", SECRET)
})

function stubEnvironment(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
}

function encryptedRows(values: Record<string, string>): StoredRow[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    storedValue: configTable.value.mapToDriverValue({ key, value }) as string,
  }))
}

/** Answers every config read with the rows the test currently holds, counting the reads. */
function configDatabase(state: { rows: StoredRow[]; reads: number; gate?: Effect.Effect<void> }) {
  const read = Effect.suspend(() => {
    state.reads += 1
    return (state.gate ?? Effect.void).pipe(Effect.as(state.rows))
  })
  const query = Object.assign(read, { where: () => read })
  return Layer.succeed(Database, {
    select: () => ({ from: () => query }),
  } as unknown as EffectDatabase)
}

const configMigrations = Layer.succeed(DatabaseMigrations, {
  state: Effect.sync(() => ({
    pending: migrations.pending ? [{ name: "pending", sql: "", hash: "", folderMillis: 0 }] : [],
    appliedCount: 0,
  })),
  apply: () => Effect.void,
})

function configLayer(state: { rows: StoredRow[]; reads: number; gate?: Effect.Effect<void> }) {
  return Config.layerNoDeps.pipe(Layer.provide([configDatabase(state), configMigrations]))
}

describe("configuration registry", () => {
  it("rejects invalid values without repeating them", () => {
    const secret = "private-test-secret"
    for (const [key, value] of [
      ["better_auth_secret", secret],
      ["email_provider", secret],
      ["smtp_port", { password: secret }],
      ["app_base_url", `https://${secret}@example.com`],
      ["email_from_address", "secret@@value"],
    ] as const) {
      const decoded = decodeConfigValue(findConfigDefinition(key)!, value)
      assert.isTrue(Result.isFailure(decoded))
      assert.notInclude(Result.isFailure(decoded) ? decoded.failure.message : "", secret)
    }
    const fromAddress = findConfigDefinition("email_from_address")!
    for (const accepted of ["onboarding@resend.dev", "App <onboarding@resend.dev>"]) {
      assert.deepStrictEqual(decodeConfigValue(fromAddress, accepted), Result.succeed(accepted))
    }
  })

  it("requires a from address for any provider other than SMTP", () => {
    const issues = validateConfigCompleteness(
      { ...COMPLETE_VALUES, email_provider: "resend", resend_api_key: "resend-api-key" },
      new Set(),
    )
    assert.include(
      issues.map((issue) => issue.key),
      "email_from_address",
    )
  })

  it("refuses a dogfood credential issued by another organization", () => {
    const issues = validateConfigCompleteness(
      { ...COMPLETE_VALUES, dogfood_organization_id: "01990a5d-0000-7000-8000-000000000099" },
      new Set(),
    )
    assert.deepInclude(issues, {
      key: "dogfood_api_key",
      message: "Embedded assistant credential ownership is invalid",
    })
  })

  it("derives public configuration without any stored secret", () => {
    const serialized = JSON.stringify(
      publicConfigFromValues({
        ...COMPLETE_VALUES,
        google_client_id: "google-id",
        google_client_secret: "google-secret",
        resend_api_key: "resend-secret",
      }),
    )
    assert.include(serialized, "turnstile-site-key")
    for (const secret of ["google-secret", "resend-secret", SECRET, "turnstile-secret-key"]) {
      assert.notInclude(serialized, secret)
    }
  })
})

describe("Config", () => {
  it.effect("lets environment values override stored ones while defaults remain", () => {
    const state = { rows: encryptedRows(COMPLETE_VALUES), reads: 0 }
    stubEnvironment({
      APP_BASE_URL: JSON.stringify("https://environment.example"),
      BETTER_AUTH_SECRET: JSON.stringify("b".repeat(64)),
      SMTP_PORT: "587",
      DOGFOOD_API_KEY: "attacker-value",
    })
    return Effect.gen(function* () {
      const { values, environmentKeys } = yield* Effect.flatMap(Config, (config) => config.snapshot)
      assert.deepInclude(values, {
        app_base_url: "https://environment.example",
        better_auth_secret: "b".repeat(64),
        email_provider: "smtp",
        smtp_host: "127.0.0.1",
        smtp_port: "587",
        smtp_security: "none",
        // System-managed values stay database-only.
        dogfood_api_key: COMPLETE_VALUES.dogfood_api_key,
      })
      assert.isFalse(environmentKeys.has("dogfood_api_key"))
    }).pipe(Effect.provide(configLayer(state)))
  })

  it.effect("keeps only features that need an unreadable value incomplete", () => {
    const { better_auth_secret: _, ...withoutSecret } = COMPLETE_VALUES
    const unreadable = [
      { key: "better_auth_secret", storedValue: "not-a-compact-jwe" },
      { key: "resend_api_key", storedValue: "not-a-compact-jwe" },
    ]
    const state = {
      rows: [
        ...encryptedRows({
          ...withoutSecret,
          email_from_address: "hello@example.com",
          email_provider: "resend",
        }),
        ...unreadable,
      ],
      reads: 0,
    }
    return Effect.gen(function* () {
      const config = yield* Config
      const issues = (yield* config.snapshot).issues.map((issue) => issue.key)
      assert.includeMembers(issues, ["better_auth_secret", "resend_api_key"])

      state.rows = [...encryptedRows(COMPLETE_VALUES), unreadable[1]!]
      yield* config.invalidate
      assert.deepStrictEqual((yield* config.snapshot).issues, [])
    }).pipe(Effect.provide(configLayer(state)))
  })

  it.effect("completes setup only with complete configuration and no pending migration", () => {
    const state = { rows: [] as StoredRow[], reads: 0 }
    return Effect.gen(function* () {
      const config = yield* Config
      assert.isFalse((yield* config.setupState).setupComplete)
      assert.isNull(yield* config.publicConfig)

      state.rows = encryptedRows(COMPLETE_VALUES)
      yield* config.invalidate
      assert.isTrue((yield* config.setupState).setupComplete)

      migrations.pending = true
      assert.isFalse((yield* config.setupState).setupComplete)
    }).pipe(Effect.provide(configLayer(state)))
  })

  it.effect("reads once until invalidated, and never caches a load that began before", () => {
    return Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const state = { rows: encryptedRows(COMPLETE_VALUES), reads: 0, gate: Effect.void }
      const config = yield* Config.pipe(Effect.provide(configLayer(state)))
      yield* config.snapshot
      yield* config.snapshot
      assert.strictEqual(state.reads, 1)

      state.gate = Deferred.await(release)
      yield* config.invalidate
      const stale = yield* Effect.forkChild(config.snapshot)
      yield* Effect.yieldNow
      state.gate = Effect.void
      state.rows = encryptedRows({ ...COMPLETE_VALUES, app_base_url: "https://fresh.example" })
      yield* config.invalidate
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(stale)
      assert.strictEqual(yield* config.get("app_base_url"), "https://fresh.example")
    })
  })

  it.effect("refuses generic writes to system-managed and environment-supplied keys", () => {
    const state = { rows: encryptedRows(COMPLETE_VALUES), reads: 0 }
    stubEnvironment({ APP_BASE_URL: "https://environment.example" })
    return Effect.gen(function* () {
      const config = yield* Config
      for (const key of ["dogfood_organization_id", "dogfood_api_key", "app_base_url"]) {
        const error = yield* Effect.flip(config.update([{ key, value: "attacker-value" }]))
        assert.strictEqual(error._tag, "ConfigUpdateInvalid")
        assert.strictEqual(error.issues[0]?.key, key)
      }
      assert.strictEqual(
        (yield* Effect.flip(config.reveal("dogfood_api_key")))._tag,
        "ConfigValueNotRevealable",
      )
    }).pipe(Effect.provide(configLayer(state)))
  })
})
