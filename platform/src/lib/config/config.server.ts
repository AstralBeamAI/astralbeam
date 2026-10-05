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
} from "effect"
import { SqlClient } from "effect/sql"

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
  parseEnvironmentConfigValue,
  validateConfigCompleteness,
} from "./registry.server.ts"
import {
  type DatabaseConfigChange,
  type DatabaseConfigState,
  readDatabaseConfig,
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
    // Setup cannot complete without the site key.
    turnstileSiteKey: values.turnstile_site_key ?? "",
    privacyPolicyUrl: values.privacy_policy_url,
    termsOfServiceUrl: values.terms_of_service_url,
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
    /**
     * Writes system-managed or pre-validated values, joining the caller's transaction. Invalidate
     * after it commits.
     */
    readonly write: (changes: readonly DatabaseConfigChange[]) => Effect.Effect<void>
    /** Applies an operator's `/configure` updates and generates missing required secrets. */
    readonly update: (updates: readonly ConfigUpdate[]) => Effect.Effect<void, ConfigUpdateInvalid>
    readonly generate: (key: string) => Effect.Effect<void, ConfigValueNotGeneratable>
    /** Returns one secret for the operator who asked to see it. */
    readonly reveal: (key: string) => Effect.Effect<string | null, ConfigValueNotRevealable>
    readonly applyMigrations: (
      approved: readonly { readonly name: string; readonly hash: string }[],
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
        return {
          generation: yield* Ref.updateAndGet(generations, (generation) => generation + 1),
          rows: stored.rows,
          values,
          issues: validateConfigCompleteness(values, environmentKeys),
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

      const write = Effect.fn("Config.write")(function* (changes: readonly DatabaseConfigChange[]) {
        yield* writeDatabaseConfig(db, changes)
      })

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
        yield* writeDatabaseConfig(db, decoded.changes, generated.values)
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
        function* (approved: readonly { readonly name: string; readonly hash: string }[]) {
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
        write,
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
