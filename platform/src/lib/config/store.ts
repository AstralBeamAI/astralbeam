import { eq, inArray, sql } from "drizzle-orm"
import { Effect, Result } from "effect"

import type { EffectDatabase } from "@/db/database"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue } from "@/db/lib/encryption"
import { sqlState } from "@/db/lib/sqlstate"
import { configTable, ConfigValuePayloadSchema } from "@/db/schema/config"
import { CONFIG_DEFINITIONS, decodeConfigValue, findConfigDefinition } from "./registry.ts"
import type { ConfigKey, ConfigStorageEntry, ConfigValues } from "./types.ts"

export interface DatabaseConfigChange {
  readonly key: string
  /** `null` deletes the stored value. */
  readonly value: string | null
}

export interface DatabaseConfigState {
  /** `null` while the config table does not exist yet. */
  readonly rows: readonly ConfigStorageEntry[] | null
  readonly values: ConfigValues
}

const configReadColumns = {
  key: configTable.key,
  storedValue: sql<string>`${configTable.value}::text`,
}

function decryptStoredConfigRow(row: { key: string; storedValue: string }) {
  const decrypted = decryptDatabaseValue({
    storedValue: row.storedValue,
    schema: ConfigValuePayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  return {
    value:
      Result.isSuccess(decrypted) && decrypted.success.value.key === row.key
        ? decrypted.success.value.value
        : undefined,
    usedFallbackKey: Result.isSuccess(decrypted) && decrypted.success.usedFallbackKey,
  }
}

const warnInvalidConfigValue = (key: string) =>
  Effect.logWarning("Ignoring invalid stored config value").pipe(Effect.annotateLogs({ key }))

/** Reads stored values without environment overrides, treating a missing table as empty. */
export const readDatabaseConfig = Effect.fnUntraced(function* (
  db: EffectDatabase,
  excludedKeys: readonly ConfigKey[] = [],
) {
  const stored = yield* db
    .select(configReadColumns)
    .from(configTable)
    .where(
      inArray(
        configTable.key,
        CONFIG_DEFINITIONS.map(({ key }) => key).filter((key) => !excludedKeys.includes(key)),
      ),
    )
    .pipe(
      Effect.catchIf(
        (error) => sqlState(error) === "42P01",
        () => Effect.succeed(null),
      ),
      Effect.orDie,
    )
  const values: ConfigValues = {}
  if (stored === null) return { rows: null, values } satisfies DatabaseConfigState
  const rows: ConfigStorageEntry[] = []
  for (const row of stored) {
    const { key } = row
    const definition = findConfigDefinition(key)
    if (!definition) continue
    const { value, usedFallbackKey } = decryptStoredConfigRow(row)
    const decoded = value === undefined ? undefined : decodeConfigValue(definition, value)
    if (decoded && Result.isSuccess(decoded)) {
      values[definition.key] = decoded.success
      rows.push(usedFallbackKey ? { key, storageStatus: "fallback-key" } : { key })
    } else {
      yield* warnInvalidConfigValue(key)
      rows.push({ key, storageStatus: "unreadable" })
    }
  }
  return { rows, values } satisfies DatabaseConfigState
})

export const readDatabaseConfigValue = Effect.fn("readDatabaseConfigValue")(function* (
  db: EffectDatabase,
  key: string,
) {
  const rows = yield* db
    .select(configReadColumns)
    .from(configTable)
    .where(eq(configTable.key, key))
    .pipe(Effect.orDie)
  if (!rows[0]) return null
  const { value } = decryptStoredConfigRow(rows[0])
  if (value === undefined) yield* warnInvalidConfigValue(key)
  return value ?? null
})

const storedConfigValue = Effect.fnUntraced(function* (key: string, value: string) {
  const definition = findConfigDefinition(key)
  const decoded = definition
    ? yield* Effect.fromResult(decodeConfigValue(definition, value))
    : value
  return { key, value: { key, value: decoded } }
})

/**
 * Upserts or deletes each change and inserts generated values only where none is stored. Callers
 * validate values first, so a rejected one is a defect. Invalidate the `Config` cache after commit.
 */
export const writeDatabaseConfig = Effect.fn("Config.write")(function* (
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
              set: { value: stored.value },
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
