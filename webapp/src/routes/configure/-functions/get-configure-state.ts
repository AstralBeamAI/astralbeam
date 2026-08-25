import { createServerFn } from "@tanstack/react-start"

import type { ConfigureField, ConfigureState } from "../-lib/types"

export const getConfigureState = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConfigureState> => {
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { CONFIG_DEFINITIONS, decodeStoredConfigValues, getConfig, validateConfigCompleteness } =
      await import("@/lib/config.server")
    const { getMigrationState } = await import("../-lib/migrations.server")
    const { listConfigRows } = await import("../-lib/db.server")
    const snapshot = await getConfig()
    const session = await getOperatorSession()
    if (!session) return { authenticated: false, setupComplete: snapshot.setupComplete }

    const [migrationState, rows] = await Promise.all([
      getMigrationState(),
      listConfigRows(),
    ])
    const rowsByKey = new Map((rows ?? []).map((row) => [row.key, row]))
    const fields: ConfigureField[] = CONFIG_DEFINITIONS.map((definition) => {
      const row = rowsByKey.get(definition.key)
      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        kind: definition.kind,
        required: definition.required,
        secret: definition.secret,
        ...(definition.options ? { options: definition.options } : {}),
        canGenerate: definition.generate !== undefined,
        isSet: row !== undefined,
        // Secret values never leave the server; the editor only learns that one is set.
        value: !definition.secret && typeof row?.value === "string" ? row.value : null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        updatedBy: row?.updatedBy ?? null,
      }
    })
    const issues = validateConfigCompleteness(decodeStoredConfigValues(rows ?? []))
    return {
      authenticated: true,
      dbUsername: session.dbUsername,
      setupComplete: snapshot.setupComplete,
      migrations: {
        pending: migrationState.pending.map(({ name, sql }) => ({ name, sql })),
        appliedCount: migrationState.appliedCount,
      },
      fields,
      issues,
    }
  },
)
