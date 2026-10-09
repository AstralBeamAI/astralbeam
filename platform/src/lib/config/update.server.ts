import { Result } from "effect"

import {
  CONFIG_DEFINITIONS,
  configEnvironmentVariable,
  decodeConfigValue,
  findConfigDefinition,
} from "./registry.server.ts"
import type { DatabaseConfigChange } from "./store.server.ts"
import type { ConfigKey, ConfigStorageEntry, ConfigValues } from "./types.ts"

export interface ConfigUpdate {
  readonly key: string
  /** `null` clears an optional value. */
  readonly value: string | null
}

interface ConfigUpdateIssue {
  readonly key: string
  readonly message: string
}

/** Decodes operator updates, refusing system-managed, environment-supplied and duplicate keys. */
export function validateConfigUpdates(
  updates: readonly ConfigUpdate[],
  environmentKeys: ReadonlySet<ConfigKey>,
) {
  const changes: (DatabaseConfigChange & { readonly key: ConfigKey })[] = []
  const issues: ConfigUpdateIssue[] = []
  const seenKeys = new Set<string>()
  for (const update of updates) {
    if (seenKeys.has(update.key)) {
      issues.push({ key: update.key, message: "Duplicate configuration update" })
      continue
    }
    seenKeys.add(update.key)
    const definition = findConfigDefinition(update.key)
    if (!definition || definition.systemManaged) {
      issues.push({ key: update.key, message: "Unknown configuration key" })
      continue
    }
    if (environmentKeys.has(definition.key)) {
      issues.push({
        key: definition.key,
        message: `This value is provided by ${configEnvironmentVariable(definition.key)}`,
      })
      continue
    }
    if (update.value === null) {
      if (definition.required) {
        issues.push({ key: definition.key, message: "Required configuration cannot be cleared" })
      } else {
        changes.push({ key: definition.key, value: null })
      }
      continue
    }
    const decoded = decodeConfigValue(definition, update.value)
    if (Result.isSuccess(decoded)) changes.push({ key: definition.key, value: decoded.success })
    else issues.push({ key: definition.key, message: decoded.failure.message })
  }
  return { changes, issues }
}

/** Generates each required value that is neither stored, effective, nor being changed. */
export function generateMissingConfigValues(
  current: { readonly rows: readonly ConfigStorageEntry[] | null; readonly values: ConfigValues },
  changedKeys: ReadonlySet<ConfigKey>,
) {
  const values: { key: ConfigKey; value: string }[] = []
  const issues: ConfigUpdateIssue[] = []
  const storedKeys = new Set((current.rows ?? []).map((row) => row.key))
  for (const definition of CONFIG_DEFINITIONS) {
    if (
      !definition.required ||
      !definition.generate ||
      current.values[definition.key] ||
      storedKeys.has(definition.key) ||
      changedKeys.has(definition.key)
    )
      continue
    const decoded = decodeConfigValue(definition, definition.generate())
    if (Result.isSuccess(decoded)) values.push({ key: definition.key, value: decoded.success })
    else issues.push({ key: definition.key, message: "A required value could not be generated" })
  }
  return { values, issues }
}
