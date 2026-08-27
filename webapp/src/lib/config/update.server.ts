import { applyDatabaseConfigChanges } from "@/db/config.server"
import {
  CONFIG_DEFINITIONS,
  configEnvironmentVariable,
  findConfigDefinition,
  hasEnvironmentConfigOverride,
} from "@/lib/config/registry.server"
import { getGlobalConfigState, invalidateGlobalConfig } from "@/lib/config/runtime.server"
import type { ConfigKey } from "@/lib/types"

type GlobalConfigUpdate = {
  readonly key: string
  readonly value: string | null
}

type GlobalConfigUpdateIssue = {
  readonly key: string
  readonly message: string
}

type GlobalConfigUpdateResult =
  | { readonly ok: false; readonly fieldErrors: GlobalConfigUpdateIssue[] }
  | { readonly ok: true }

function validateConfigUpdates(updates: readonly GlobalConfigUpdate[]) {
  const changes: { key: ConfigKey; value: string | null }[] = []
  const fieldErrors: GlobalConfigUpdateIssue[] = []
  const seenKeys = new Set<string>()
  for (const update of updates) {
    if (seenKeys.has(update.key)) {
      fieldErrors.push({ key: update.key, message: "Duplicate configuration update" })
      continue
    }
    seenKeys.add(update.key)
    const definition = findConfigDefinition(update.key)
    if (!definition) {
      fieldErrors.push({ key: update.key, message: "Unknown configuration key" })
      continue
    }
    if (hasEnvironmentConfigOverride(definition.key)) {
      fieldErrors.push({
        key: definition.key,
        message: `This value is provided by ${configEnvironmentVariable(definition.key)}`,
      })
      continue
    }
    if (update.value === null) {
      if (definition.required) {
        fieldErrors.push({
          key: definition.key,
          message: "Required configuration cannot be cleared",
        })
      } else {
        changes.push({ key: definition.key, value: null })
      }
      continue
    }
    try {
      changes.push({ key: definition.key, value: definition.decode(update.value) })
    } catch (error) {
      fieldErrors.push({
        key: definition.key,
        message: error instanceof Error ? error.message : "Invalid value",
      })
    }
  }
  return { changes, fieldErrors }
}

function generateMissingValues(
  state: Awaited<ReturnType<typeof getGlobalConfigState>>,
  changedKeys: ReadonlySet<ConfigKey>,
) {
  const values: { key: ConfigKey; value: string }[] = []
  const fieldErrors: GlobalConfigUpdateIssue[] = []
  const storedKeys = new Set((state.rows ?? []).map((row) => row.key))
  for (const definition of CONFIG_DEFINITIONS) {
    if (
      !definition.required || !definition.generate || state.values[definition.key] ||
      storedKeys.has(definition.key) || changedKeys.has(definition.key)
    ) continue
    try {
      values.push({ key: definition.key, value: definition.decode(definition.generate()) })
    } catch (error) {
      fieldErrors.push({
        key: definition.key,
        message: error instanceof Error ? error.message : "A required value could not be generated",
      })
    }
  }
  return { values, fieldErrors }
}

export async function updateGlobalConfig(
  updates: readonly GlobalConfigUpdate[],
): Promise<GlobalConfigUpdateResult> {
  const decoded = validateConfigUpdates(updates)
  if (decoded.fieldErrors.length > 0) return { ok: false, fieldErrors: decoded.fieldErrors }

  const generated = generateMissingValues(
    await getGlobalConfigState(),
    new Set(decoded.changes.map((change) => change.key)),
  )
  if (generated.fieldErrors.length > 0) return { ok: false, fieldErrors: generated.fieldErrors }

  await applyDatabaseConfigChanges(decoded.changes, generated.values)
  invalidateGlobalConfig()
  return { ok: true }
}
