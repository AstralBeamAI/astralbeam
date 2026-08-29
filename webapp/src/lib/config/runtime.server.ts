import { getDatabaseConfig } from "@/db/config.server"
import {
  DEFAULT_CONFIG_VALUES,
  environmentConfigOverrideKeys,
  environmentConfigValues,
  validateConfigCompleteness,
} from "@/lib/config/registry.server"
import type { ConfigIssue, ConfigKey, ConfigStorageEntry, ConfigValues } from "@/lib/types"

type GlobalConfigState = {
  rows: ConfigStorageEntry[] | null
  values: ConfigValues
  issues: ConfigIssue[]
}

let cachedState: GlobalConfigState | null = null
let refresh: { generation: number; promise: Promise<GlobalConfigState> } | null = null
let generation = 0

async function refreshState(currentGeneration: number): Promise<GlobalConfigState> {
  const stored = await getDatabaseConfig(environmentConfigOverrideKeys())
  const values = { ...DEFAULT_CONFIG_VALUES, ...stored.values, ...environmentConfigValues() }
  const issues = validateConfigCompleteness(values)
  const state = {
    rows: stored.rows,
    values,
    issues,
  }
  if (currentGeneration === generation) cachedState = state
  return state
}

function loadState(): Promise<GlobalConfigState> {
  if (cachedState) return Promise.resolve(cachedState)
  if (refresh?.generation === generation) return refresh.promise

  const currentGeneration = generation
  const promise = refreshState(currentGeneration).finally(() => {
    if (refresh?.promise === promise) refresh = null
  })
  refresh = { generation: currentGeneration, promise }
  return promise
}

export async function getGlobalConfig<Key extends ConfigKey>(
  key: Key,
): Promise<ConfigValues[Key]> {
  return (await loadState()).values[key]
}

export async function getGlobalConfigState(): Promise<GlobalConfigState> {
  return await loadState()
}

export function invalidateGlobalConfig(): void {
  generation += 1
  cachedState = null
}

// Every process loads configuration once. Same-process writes invalidate it; other processes
// reload on restart by design.
