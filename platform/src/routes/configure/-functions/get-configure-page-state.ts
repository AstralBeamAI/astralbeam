import { createServerFn } from "@tanstack/react-start"

import { readDogfoodOnboarding } from "@/lib/dogfood/provisioning.server"
import { runDatabaseEffect } from "@/db"
import { getGlobalConfigState } from "@/lib/config/runtime.server"
import { getDatabaseMigrationState } from "@/db/migration-runner.server"
import {
  getDatabaseBootstrapIssues,
  getDatabaseEncryptionKeyring,
} from "@/db/lib/database-credentials.server"
import {
  CONFIG_DEFINITIONS,
  configEnvironmentVariable,
  environmentConfigOverrideKeys,
} from "@/lib/config/registry.server"
import { withConfigureError } from "../-lib/configure-error.server"
import { requireConfigureRequest } from "../-lib/configure-request.server"
import { getOperatorSession } from "../-lib/operator-session.server"
import type { ConfigureField, ConfigurePageState } from "../-lib/types"

export const getConfigurePageState = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConfigurePageState> => {
    requireConfigureRequest()
    const bootstrapIssues = getDatabaseBootstrapIssues()
    if (bootstrapIssues.length > 0) return { status: "unavailable", bootstrapIssues }

    const session = await getOperatorSession()
    if (!session) return { status: "signed-out" }

    const [migrationState, configState] = await Promise.all([
      withConfigureError("Migration state could not be loaded", getDatabaseMigrationState),
      withConfigureError("Configuration could not be loaded", getGlobalConfigState),
    ])
    const { issues, rows, values: effectiveValues } = configState
    const setupComplete = issues.length === 0 && migrationState.pending.length === 0
    const rowsByKey = new Map((rows ?? []).map((row) => [row.key, row]))
    const overriddenKeys = new Set(environmentConfigOverrideKeys())
    const fields: ConfigureField[] = CONFIG_DEFINITIONS.filter(
      (definition) => !definition.systemManaged,
    ).map((definition) => {
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
        isSet:
          source === "environment"
            ? effectiveValues[definition.key] !== undefined
            : row !== undefined,
        ...(row?.storageStatus ? { storageStatus: row.storageStatus } : {}),
        // A secret never leaves with the page; `isSet` drives the masked state and
        // `revealConfigValue` fetches the one value an operator asks to see.
        value: definition.kind === "secret" ? null : (effectiveValues[definition.key] ?? null),
      }
    })
    const onboarding =
      migrationState.pending.length === 0
        ? await withConfigureError("Owner onboarding could not be read", () =>
            runDatabaseEffect(readDogfoodOnboarding(effectiveValues)),
          )
        : null
    return {
      status: "ready",
      onboarding,
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
