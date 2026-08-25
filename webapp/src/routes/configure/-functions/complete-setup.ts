import { createServerFn } from "@tanstack/react-start"

import type { ConfigureIssue } from "../-lib/types"

export interface CompleteSetupResult {
  ok: boolean
  error?: string
  issues?: ConfigureIssue[]
}

export const completeSetup = createServerFn({ method: "POST" }).handler(
  async (): Promise<CompleteSetupResult> => {
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const {
      configDefinition,
      decodeStoredConfigValues,
      invalidateConfigCache,
      SETUP_COMPLETED_KEY,
      validateConfigCompleteness,
    } = await import("@/lib/config.server")
    const { listConfigRows, upsertConfigValue } = await import("../-lib/db.server")
    const { getMigrationState } = await import("../-lib/migrations.server")
    const session = await getOperatorSession()
    if (!session) return { ok: false, error: "Operator authentication required" }

    const migrationState = await getMigrationState()
    if (migrationState.pending.length > 0) {
      return { ok: false, error: "Apply the pending database migrations first" }
    }

    // Generate the authentication secret rather than making the operator produce one.
    const rows = await listConfigRows()
    let values = decodeStoredConfigValues(rows ?? [])
    if (!values.better_auth_secret) {
      const definition = configDefinition("better_auth_secret")
      if (definition?.generate) {
        await upsertConfigValue({
          key: definition.key,
          value: definition.generate(),
          updatedBy: session.dbUsername,
        })
        values = decodeStoredConfigValues(await listConfigRows() ?? [])
      }
    }

    const issues = validateConfigCompleteness(values)
    if (issues.length > 0) {
      invalidateConfigCache()
      return { ok: false, issues }
    }

    await upsertConfigValue({
      key: SETUP_COMPLETED_KEY,
      value: true,
      updatedBy: session.dbUsername,
    })
    invalidateConfigCache()
    return { ok: true }
  },
)
