import {
  Cache,
  Config as EffectConfig,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
} from "effect"
import { sql } from "drizzle-orm"
import { SqlClient } from "effect/sql"

import { StorageDestinationLocked } from "@/lib/storage/errors"
import { StoredStorageDestinationSchema, type StorageConnection } from "@/lib/storage/schemas"

import { Database } from "@/db/database.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import {
  DatabaseMigrations,
  type DatabaseMigrationState,
  type MigrationsNotApplied,
} from "@/db/migration-runner.server"
import {
  ConfigEnvironmentInvalid,
  ConfigUpdateInvalid,
  ConfigValueNotGeneratable,
  ConfigValueNotRevealable,
} from "./errors.ts"
import {
  configEnvironmentVariable,
  decodeConfigValue,
  DEFAULT_CONFIG_VALUES,
  ENVIRONMENT_CONFIG_DEFINITIONS,
  findConfigDefinition,
  validateConfigCompleteness,
} from "./registry.server.ts"
import { parseEnvironmentConfigValue } from "./schemas.ts"
import {
  type DatabaseConfigChange,
  type DatabaseConfigState,
  readDatabaseConfig,
  readDatabaseConfigValue,
  writeDatabaseConfig,
} from "./store.server.ts"
import {
  type ConfigUpdate,
  generateMissingConfigValues,
  validateConfigUpdates,
} from "./update.server.ts"
import type {
  ConfigIssue,
  ConfigKey,
  ConfigStorageEntry,
  ConfigValues,
  PublicConfig,
} from "./types.ts"

/** One load of the effective configuration: defaults, then stored values, then the environment. */
export interface ConfigSnapshot {
  /** Increments with every load, so values derived from a snapshot know when to rebuild. */
  readonly generation: number
  readonly rows: readonly ConfigStorageEntry[] | null
  readonly values: ConfigValues
  readonly issues: readonly ConfigIssue[]
  /** Keys whose uppercase environment variable overrides the database. */
  readonly environmentKeys: ReadonlySet<ConfigKey>
}

export interface SetupState {
  readonly snapshot: ConfigSnapshot
  readonly migrations: DatabaseMigrationState
  /** Derived from process-cached configuration and migration state, never a persisted marker. */
  readonly setupComplete: boolean
}

const environmentConfig = EffectConfig.all(
  Object.fromEntries(
    ENVIRONMENT_CONFIG_DEFINITIONS.map((definition) => [
      definition.key,
      EffectConfig.option(EffectConfig.String(configEnvironmentVariable(definition.key))),
    ]),
  ),
)

/** Environment values, decoded like stored ones. An invalid value fails every load until fixed. */
const readEnvironmentConfig = Effect.fnUntraced(function* () {
  const raw = yield* environmentConfig.pipe(
    // Each load rereads the process environment, as it rereads the stored values it overrides.
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
    Effect.orDie,
  )
  const values: ConfigValues = {}
  for (const definition of ENVIRONMENT_CONFIG_DEFINITIONS) {
    const value = raw[definition.key]
    if (!value || Option.isNone(value)) continue
    const decoded = decodeConfigValue(definition, parseEnvironmentConfigValue(value.value))
    if (Result.isSuccess(decoded)) {
      values[definition.key] = decoded.success
      continue
    }
    const variable = configEnvironmentVariable(definition.key)
    yield* Effect.logError("Environment configuration is invalid").pipe(
      Effect.annotateLogs({ variable }),
    )
    return yield* Effect.die(new ConfigEnvironmentInvalid({ variable }))
  }
  return values
})

/** The secret-free slice of a complete configuration that browsers may see. */
export function publicConfigFromValues(values: ConfigValues): PublicConfig {
  const enabledSocialProviders: PublicConfig["enabledSocialProviders"] = []
  if (values.google_client_id && values.google_client_secret) enabledSocialProviders.push("google")
  if (values.github_client_id && values.github_client_secret) enabledSocialProviders.push("github")
  return {
    enabledSocialProviders,
    // Setup cannot complete without the site key or the support address.
    turnstileSiteKey: values.turnstile_site_key ?? "",
    privacyPolicyUrl: values.privacy_policy_url,
    termsOfServiceUrl: values.terms_of_service_url,
    supportEmailAddress: values.support_email_address ?? "",
    hasWebsite: values.website_url !== undefined,
  }
}

export class Config extends Context.Service<
  Config,
  {
    /** Cached per process until a same-process write invalidates it. Other processes restart. */
    readonly snapshot: Effect.Effect<ConfigSnapshot>
    readonly get: <Key extends ConfigKey>(key: Key) => Effect.Effect<ConfigValues[Key]>
    readonly invalidate: Effect.Effect<void>
    readonly setupState: Effect.Effect<SetupState>
    /** `null` until setup completes. */
    readonly publicConfig: Effect.Effect<PublicConfig | null>
    /** Stored values without environment overrides, for owner onboarding. */
    readonly readStored: Effect.Effect<DatabaseConfigState>
    /** Reads a database-only value without the process-local snapshot or environment overrides. */
    readonly readStoredValue: (key: string) => Effect.Effect<string | null>
    /**
     * Writes system-managed or pre-validated values, joining the caller's transaction. Invalidate
     * after it commits.
     */
    readonly write: (changes: readonly DatabaseConfigChange[]) => Effect.Effect<void>
    /** Pins a destination before the first application upload, outside any S3 request. */
    readonly reserveStorageDestination: (
      connection: StorageConnection,
    ) => Effect.Effect<void, StorageDestinationLocked>
    /** Applies an operator's `/configure` updates and generates missing required secrets. */
    readonly update: (updates: readonly ConfigUpdate[]) => Effect.Effect<void, ConfigUpdateInvalid>
    readonly generate: (key: string) => Effect.Effect<void, ConfigValueNotGeneratable>
    /** Returns one secret for the operator who asked to see it. */
    readonly reveal: (key: string) => Effect.Effect<string | null, ConfigValueNotRevealable>
    readonly applyMigrations: (
      approved: readonly string[],
    ) => Effect.Effect<void, MigrationsNotApplied>
  }
>()("astralbeam/config/Config") {
  static readonly layerNoDeps = Layer.effect(
    Config,
    Effect.gen(function* () {
      const db = yield* Database
      const migrations = yield* DatabaseMigrations
      const generations = yield* Ref.make(0)
      // A load joining a caller's transaction would cache values that transaction may roll back.
      const sqlClient = yield* Effect.serviceOption(SqlClient.SqlClient)
      const outsideTransactions = (effect: Effect.Effect<ConfigSnapshot>) =>
        Option.isSome(sqlClient)
          ? Effect.updateContext(effect, (context: Context.Context<never>) =>
              Context.omit(sqlClient.value.transactionService)(context),
            )
          : effect

      const load = Effect.gen(function* () {
        const environment = yield* readEnvironmentConfig()
        const environmentKeys = new Set(Object.keys(environment) as ConfigKey[])
        const stored = yield* readDatabaseConfig(db, [...environmentKeys])
        const values = { ...DEFAULT_CONFIG_VALUES, ...stored.values, ...environment }
        const issues = validateConfigCompleteness(values, environmentKeys)
        if (storageDestinationMismatch(stored, values))
          issues.push({ key: "s3_endpoint", message: new StorageDestinationLocked().message })
        return {
          generation: yield* Ref.updateAndGet(generations, (generation) => generation + 1),
          rows: stored.rows,
          values,
          issues,
          environmentKeys,
        } satisfies ConfigSnapshot
      }).pipe(Effect.withSpan("Config.load"), outsideTransactions)

      const cache = yield* Cache.makeWith(() => load, {
        capacity: 1,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
      })
      const snapshot = Cache.get(cache, "snapshot")
      const invalidate = Cache.invalidate(cache, "snapshot")

      const setupState = Effect.all([snapshot, migrations.state], {
        concurrency: "unbounded",
      }).pipe(
        Effect.map(([current, migrations]) => ({
          snapshot: current,
          migrations,
          setupComplete: current.issues.length === 0 && migrations.pending.length === 0,
        })),
      )

      const storageTransaction = <A, E>(
        run: (stored: DatabaseConfigState, values: ConfigValues) => Effect.Effect<A, E>,
      ) =>
        db
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .execute(
                  sql`select pg_advisory_xact_lock(hashtextextended('file-storage-destination', 0))`,
                )
                .pipe(Effect.orDie)
              const stored = yield* readDatabaseConfig(db)
              const environment = yield* readEnvironmentConfig()
              return yield* run(stored, {
                ...DEFAULT_CONFIG_VALUES,
                ...stored.values,
                ...environment,
              })
            }),
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))

      const reserveStorageDestination = Effect.fn("Config.reserveStorageDestination")(
        (connection: StorageConnection) =>
          storageTransaction((stored, values) =>
            Effect.gen(function* () {
              const expected = storageDestinationIdentity({
                s3_endpoint: connection.endpoint,
                s3_region: connection.region,
                s3_bucket: connection.bucket,
                s3_path_style: String(connection.pathStyle),
              })
              if (
                expected !== storageDestinationIdentity(values) ||
                storageDestinationMismatch(stored, values)
              )
                return yield* new StorageDestinationLocked()
              if (stored.values.s3_destination) return false
              yield* writeDatabaseConfig(db, [{ key: "s3_destination", value: expected }])
              return true
            }),
          ).pipe(
            Effect.tap((created) => (created ? invalidate : Effect.void)),
            Effect.asVoid,
          ),
      )

      const update = Effect.fn("Config.update")(function* (updates: readonly ConfigUpdate[]) {
        const current = yield* snapshot
        const decoded = validateConfigUpdates(updates, current.environmentKeys)
        if (decoded.issues.length > 0) {
          return yield* new ConfigUpdateInvalid({ issues: decoded.issues })
        }
        const generated = generateMissingConfigValues(
          current,
          new Set(decoded.changes.map((change) => change.key)),
        )
        if (generated.issues.length > 0) {
          return yield* new ConfigUpdateInvalid({ issues: generated.issues })
        }
        // Hidden system-managed values must rotate on saves without being sent to the browser.
        if (getDatabaseEncryptionKeyring().length > 1) {
          const stored = yield* readDatabaseConfig(db)
          for (const row of stored.rows ?? []) {
            const definition = findConfigDefinition(row.key)
            if (definition?.systemManaged && row.storageStatus === "fallback-key") {
              decoded.changes.push({ key: definition.key, value: stored.values[definition.key]! })
            }
          }
        }
        yield* storageTransaction((stored, values) =>
          Effect.gen(function* () {
            const next = { ...values }
            for (const change of decoded.changes) next[change.key] = change.value ?? undefined
            if (storageDestinationMismatch(stored, next))
              return yield* new ConfigUpdateInvalid({
                issues: [{ key: "s3_endpoint", message: new StorageDestinationLocked().message }],
              })
            yield* writeDatabaseConfig(db, decoded.changes, generated.values)
          }),
        )
        yield* invalidate
      })

      const generate = Effect.fn("Config.generate")(
        function* (key: string) {
          const definition = findConfigDefinition(key)
          if (!definition?.generate || definition.systemManaged) {
            return yield* new ConfigValueNotGeneratable()
          }
          yield* update([{ key: definition.key, value: definition.generate() }])
        },
        Effect.catchTag("ConfigUpdateInvalid", () => Effect.fail(new ConfigValueNotGeneratable())),
      )

      const reveal = Effect.fn("Config.reveal")(function* (key: string) {
        const definition = findConfigDefinition(key)
        if (!definition || definition.systemManaged || definition.kind !== "secret") {
          return yield* new ConfigValueNotRevealable()
        }
        return (yield* snapshot).values[definition.key] ?? null
      })

      const applyMigrations = Effect.fn("Config.applyMigrations")(
        function* (approved: readonly string[]) {
          yield* migrations.apply(approved)
        },
        (effect) => Effect.ensuring(effect, invalidate),
      )

      return Config.of({
        snapshot,
        get: (key) => Effect.map(snapshot, (current) => current.values[key]),
        invalidate,
        setupState,
        publicConfig: Effect.map(setupState, (state) =>
          state.setupComplete ? publicConfigFromValues(state.snapshot.values) : null,
        ),
        readStored: readDatabaseConfig(db),
        readStoredValue: (key) => readDatabaseConfigValue(db, key),
        write: (changes) => writeDatabaseConfig(db, changes),
        reserveStorageDestination,
        update,
        generate,
        reveal,
        applyMigrations,
      })
    }),
  )

  static readonly layer = Config.layerNoDeps.pipe(
    Layer.provide([Database.layer, DatabaseMigrations.layer]),
  )
}

function storageDestinationIdentity(values: ConfigValues): string {
  return JSON.stringify({
    endpoint: values.s3_endpoint,
    region: values.s3_region,
    bucket: values.s3_bucket,
    pathStyle: values.s3_path_style === "true",
  })
}

function storageDestinationMismatch(stored: DatabaseConfigState, values: ConfigValues): boolean {
  const pin = stored.values.s3_destination
  if (
    stored.rows?.some((row) => row.key === "s3_destination" && row.storageStatus === "unreadable")
  )
    return true
  if (!pin) return false
  const destination = Schema.decodeUnknownOption(StoredStorageDestinationSchema)(pin)
  return (
    Option.isNone(destination) ||
    destination.value.endpoint !== values.s3_endpoint ||
    destination.value.region !== values.s3_region ||
    destination.value.bucket !== values.s3_bucket ||
    destination.value.pathStyle !== (values.s3_path_style === "true")
  )
}
