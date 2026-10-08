import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm"
import { Effect, Option, Result } from "effect"

import type { EffectDatabase } from "@/db/database.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { decryptDatabaseValue } from "@/db/lib/encryption.server"
import { sqlState } from "@/db/lib/sqlstate.server"
import { configTable } from "@/db/schema.server"
import { ConfigValuePayloadSchema } from "@/db/schema/config.server"
import type { ModelPriceCatalog } from "@/lib/model-providers/pricing-catalog-schemas"
import { CONFIG_DEFINITIONS, decodeConfigValue, findConfigDefinition } from "./registry.server.ts"
import type { ConfigKey, ConfigStorageEntry, ConfigValues } from "./types.ts"

export interface DatabaseConfigChange {
  readonly key: ConfigKey
  /** `null` deletes the stored value. */
  readonly value: string | null
}

export interface DatabaseConfigState {
  /** `null` while the config table does not exist yet. */
  readonly rows: readonly ConfigStorageEntry[] | null
  readonly values: ConfigValues
}

type StoredConfigRow = {
  readonly key: string
  readonly payload: Option.Option<typeof ConfigValuePayloadSchema.Type>
  readonly usedFallbackKey: boolean
}

function decryptStoredConfigRow(row: { key: string; storedValue: string }): StoredConfigRow {
  const decrypted = decryptDatabaseValue({
    storedValue: row.storedValue,
    schema: ConfigValuePayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  return {
    key: row.key,
    payload: Result.isSuccess(decrypted) ? Option.some(decrypted.success.value) : Option.none(),
    usedFallbackKey: Result.isSuccess(decrypted) && decrypted.success.usedFallbackKey,
  }
}

/** A value decrypted for another key, or failing its definition, is ignored and logged by key. */
const decodeStoredConfigRows = Effect.fnUntraced(function* (rows: readonly StoredConfigRow[]) {
  const values: ConfigValues = {}
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))
  for (const definition of CONFIG_DEFINITIONS) {
    const row = rowsByKey.get(definition.key)
    if (!row) continue
    const value = Option.flatMap(
      Option.filter(row.payload, (payload) => payload.key === row.key),
      (payload) => Result.getSuccess(decodeConfigValue(definition, payload.value)),
    )
    if (Option.isSome(value)) values[definition.key] = value.value
    else {
      yield* Effect.logWarning("Ignoring invalid stored config value").pipe(
        Effect.annotateLogs({ key: definition.key }),
      )
    }
  }
  return values
})

function storageEntry(row: StoredConfigRow, values: ConfigValues): ConfigStorageEntry {
  const definition = findConfigDefinition(row.key)
  if (Option.isNone(row.payload) || (definition && values[definition.key] === undefined)) {
    return { key: row.key, storageStatus: "unreadable" }
  }
  return row.usedFallbackKey ? { key: row.key, storageStatus: "fallback-key" } : { key: row.key }
}

/** Reads stored values without environment overrides, treating a missing table as empty. */
export const readDatabaseConfig = Effect.fnUntraced(function* (
  db: EffectDatabase,
  excludedKeys: readonly ConfigKey[] = [],
) {
  const stored = yield* db
    .select({ key: configTable.key, storedValue: sql<string>`${configTable.value}::text` })
    .from(configTable)
    .where(
      and(
        isNotNull(configTable.value),
        excludedKeys.length > 0 ? notInArray(configTable.key, [...excludedKeys]) : undefined,
      ),
    )
    .pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error) => sqlState(error) === "42P01",
        () => Effect.succeed(Option.none()),
      ),
      Effect.orDie,
    )
  const rows = Option.getOrElse(stored, () => []).map(decryptStoredConfigRow)
  const values = yield* decodeStoredConfigRows(rows)
  return {
    rows: Option.isSome(stored) ? rows.map((row) => storageEntry(row, values)) : null,
    values,
  } satisfies DatabaseConfigState
})

const MODEL_PRICE_CATALOG_CONFIG_KEY = "model_price_catalog"

export const readDatabaseModelPriceCatalog = Effect.fn("readDatabaseModelPriceCatalog")(function* (
  db: EffectDatabase,
) {
  const rows = yield* db
    .select({ catalog: configTable.jsonValue })
    .from(configTable)
    .where(eq(configTable.key, MODEL_PRICE_CATALOG_CONFIG_KEY))
    .limit(1)
    .pipe(Effect.orDie)
  return rows[0]?.catalog ?? null
})

export const writeDatabaseModelPriceCatalog = Effect.fn("writeDatabaseModelPriceCatalog")(
  (db: EffectDatabase, catalog: ModelPriceCatalog) =>
    db
      .insert(configTable)
      .values({ key: MODEL_PRICE_CATALOG_CONFIG_KEY, jsonValue: catalog })
      .onConflictDoUpdate({
        target: configTable.key,
        set: { jsonValue: catalog, value: null, updatedAt: sql`now()` },
      })
      .pipe(Effect.asVoid, Effect.orDie),
)

const storedConfigValue = Effect.fnUntraced(function* (key: ConfigKey, value: string) {
  const decoded = yield* Effect.fromResult(decodeConfigValue(findConfigDefinition(key)!, value))
  return { key, value: { key, value: decoded } }
})

/**
 * Upserts or deletes each change and inserts generated values only where none is stored. Callers
 * validate values first, so a rejected one is a defect. Invalidate the `Config` cache after commit.
 */
export const writeDatabaseConfig = Effect.fnUntraced(function* (
  db: EffectDatabase,
  changes: readonly DatabaseConfigChange[],
  generatedValues: readonly { readonly key: ConfigKey; readonly value: string }[] = [],
) {
  yield* db
    .transaction((transaction) =>
      Effect.gen(function* () {
        for (const change of changes) {
          if (change.value === null) {
            yield* transaction.delete(configTable).where(eq(configTable.key, change.key))
            continue
          }
          const stored = yield* storedConfigValue(change.key, change.value)
          yield* transaction
            .insert(configTable)
            .values(stored)
            .onConflictDoUpdate({
              target: configTable.key,
              // Upserts bypass Drizzle's $onUpdateFn hook, so updated_at is set explicitly.
              set: { value: stored.value, updatedAt: sql`now()` },
            })
        }
        for (const generated of generatedValues) {
          yield* transaction
            .insert(configTable)
            .values(yield* storedConfigValue(generated.key, generated.value))
            .onConflictDoNothing({ target: configTable.key })
        }
      }),
    )
    .pipe(Effect.orDie)
})
