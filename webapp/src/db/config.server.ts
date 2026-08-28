import { eq, notInArray, sql } from "drizzle-orm"

import { decryptDatabaseValue } from "@/db/lib/encryption.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { db } from "@/db/index.server"
import { isMissingTableError } from "@/db/lib/postgres-errors.server"
import { configTable } from "@/db/schema.server"
import { decodeConfigValuePayload } from "@/db/schema/config.server"
import { CONFIG_DEFINITIONS, findConfigDefinition } from "@/lib/config/registry.server"
import type { ConfigDefinition, ConfigKey, ConfigStorageEntry, ConfigValues } from "@/lib/types"

type DatabaseConfigChange = {
  readonly key: ConfigKey
  readonly value: string | null
}

type DatabaseConfigGeneratedValue = {
  readonly key: ConfigKey
  readonly value: string
}

type StoredConfigRow = {
  readonly key: string
  readonly value?: ReturnType<typeof decodeConfigValuePayload>
  readonly storage?: NonNullable<ConfigStorageEntry["storageStatus"]>
}

type DatabaseConfigState = {
  readonly rows: ConfigStorageEntry[] | null
  readonly values: ConfigValues
}

async function readStoredConfigRows(
  excludedKeys: readonly ConfigKey[],
): Promise<StoredConfigRow[] | null> {
  try {
    const query = db
      .select({
        key: configTable.key,
        storedValue: sql<string>`${configTable.value}::text`,
      })
      .from(configTable)
    const rows = excludedKeys.length === 0
      ? await query
      : await query.where(notInArray(configTable.key, [...excludedKeys]))
    return rows.map(({ key, storedValue }) => {
      try {
        const decoded = decodeRawStoredConfigValue(storedValue)
        return {
          key,
          value: decoded.value,
          ...(decoded.usedFallbackKey ? { storage: "fallback-key" as const } : {}),
        }
      } catch {
        return { key, storage: "unreadable" }
      }
    })
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

function decodeRawStoredConfigValue(storedValue: string) {
  return decryptDatabaseValue({
    storedValue,
    decode: decodeConfigValuePayload,
    keyring: getDatabaseEncryptionKeyring(),
  })
}

function logInvalidStoredConfigValue(key: ConfigKey): void {
  console.error(`Ignoring invalid stored config value for '${key}'`)
}

function decodeStoredConfigValue(
  definition: ConfigDefinition,
  row: StoredConfigRow,
): string | undefined {
  try {
    if (!row.value || row.value.key !== row.key) throw new Error()
    return definition.decode(row.value.value)
  } catch {
    logInvalidStoredConfigValue(definition.key)
    return undefined
  }
}

function visibleStoredConfigRows(
  rows: readonly StoredConfigRow[],
  values: ConfigValues,
): ConfigStorageEntry[] {
  return rows.map((row) => {
    const definition = findConfigDefinition(row.key)
    return {
      key: row.key,
      ...(definition && values[definition.key] === undefined
        ? { storageStatus: "unreadable" as const }
        : row.storage
        ? { storageStatus: row.storage }
        : {}),
    }
  })
}

function decodeStoredConfigRows(
  rows: readonly StoredConfigRow[],
): ConfigValues {
  const values: ConfigValues = {}
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))
  for (const definition of CONFIG_DEFINITIONS) {
    const row = rowsByKey.get(definition.key)
    if (!row) continue
    const value = decodeStoredConfigValue(definition, row)
    if (value !== undefined) values[definition.key] = value
  }
  return values
}

export async function getDatabaseConfig(
  excludedKeys: readonly ConfigKey[] = [],
): Promise<DatabaseConfigState> {
  const storedRows = await readStoredConfigRows(excludedKeys)
  const values = decodeStoredConfigRows(storedRows ?? [])
  return {
    rows: storedRows === null ? null : visibleStoredConfigRows(storedRows, values),
    values,
  }
}

function databaseConfigValue(value: DatabaseConfigGeneratedValue) {
  const definition = findConfigDefinition(value.key)
  if (!definition) throw new Error("Unknown global configuration key")
  return {
    key: value.key,
    value: { key: value.key, value: definition.decode(value.value) },
  }
}

export async function applyDatabaseConfigChanges(
  changes: readonly DatabaseConfigChange[],
  generatedValues: readonly DatabaseConfigGeneratedValue[] = [],
): Promise<void> {
  await db.transaction(async (transaction) => {
    for (const change of changes) {
      if (change.value === null) {
        await transaction.delete(configTable).where(eq(configTable.key, change.key))
        continue
      }
      const storedValue = databaseConfigValue({ key: change.key, value: change.value })
      await transaction
        .insert(configTable)
        .values(storedValue)
        .onConflictDoUpdate({
          target: configTable.key,
          // Upserts bypass Drizzle's $onUpdateFn hook, so updated_at is set explicitly.
          set: { value: storedValue.value, updatedAt: sql`now()` },
        })
    }
    for (const generatedValue of generatedValues) {
      await transaction
        .insert(configTable)
        .values(databaseConfigValue(generatedValue))
        .onConflictDoNothing({ target: configTable.key })
    }
  })
}
