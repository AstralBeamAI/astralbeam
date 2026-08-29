import { createServerFn } from "@tanstack/react-start"

import type { ConfigureField, ConfigurePageState } from "../-lib/types"

export const getConfigurePageState = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConfigurePageState> => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    requireConfigureRequest()
    const { getDatabaseBootstrapIssues, getDatabaseEncryptionKeyring } = await import(
      "@/db/lib/database-credentials.server"
    )
    const bootstrapIssues = getDatabaseBootstrapIssues()
    if (bootstrapIssues.length > 0) return { status: "unavailable", bootstrapIssues }

    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const session = await getOperatorSession()
    if (!session) return { status: "signed-out" }

    const [
      { CONFIG_DEFINITIONS, configEnvironmentVariable, environmentConfigOverrideKeys },
      { getGlobalConfigState },
      { getDatabaseMigrationState },
      { withConfigureError },
    ] = await Promise.all([
      import("@/lib/config/registry.server"),
      import("@/lib/config/runtime.server"),
      import("@/db/migration-runner.server"),
      import("../-lib/configure-error.server"),
    ])

    const [migrationState, configState] = await Promise.all([
      withConfigureError("Migration state could not be loaded", getDatabaseMigrationState),
      withConfigureError(
        "Configuration could not be loaded",
        getGlobalConfigState,
      ),
    ])
    const { issues, rows, values: effectiveValues } = configState
    const setupComplete = issues.length === 0 && migrationState.pending.length === 0
    const rowsByKey = new Map((rows ?? []).map((row) => [row.key, row]))
    const overriddenKeys = new Set(environmentConfigOverrideKeys())
    const fields: ConfigureField[] = CONFIG_DEFINITIONS.map((definition) => {
      const row = rowsByKey.get(definition.key)
      const source = overriddenKeys.has(definition.key) ? "environment" : "database"
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        kind: definition.kind,
        required: definition.required,
        canGenerate: definition.generate !== undefined,
        isPublic: definition.isPublic === true,
        environmentVariable: configEnvironmentVariable(definition.key),
        source,
        ...(definition.options ? { options: definition.options } : {}),
        isSet: source === "environment"
          ? effectiveValues[definition.key] !== undefined
          : row !== undefined,
        ...(row?.storageStatus ? { storageStatus: row.storageStatus } : {}),
        value: effectiveValues[definition.key] ?? null,
      }
    })
    return {
      status: "ready",
      sessionExpiresAt: session.expiresAt.toISOString(),
      fallbackEncryptionKeyCount: getDatabaseEncryptionKeyring().length - 1,
      setupComplete,
      migrations: {
        pending: migrationState.pending.map(({ name, sql, hash }) => ({ name, sql, hash })),
        appliedCount: migrationState.appliedCount,
      },
      fields,
      issues,
    }
  },
)
