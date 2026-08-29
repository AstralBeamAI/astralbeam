import { sql } from "drizzle-orm"

import { db } from "@/db/index.server"
import {
  getDatabaseBootstrapIssues,
  getDatabaseEncryptionKeyring,
} from "@/db/lib/database-credentials.server"
import { isMissingTableError } from "@/db/lib/postgres-errors.server"
import { rateLimit } from "@/db/schema.server"
import { withConfigureError } from "../-lib/configure-error.server"
import { requireConfigureRequest } from "../-lib/configure-request.server"
import { getOperatorSession } from "../-lib/operator-session.server"
import type { ConfigureField, ConfigurePageState } from "../-lib/types"

export async function loadConfigurePageState(): Promise<ConfigurePageState> {
  requireConfigureRequest()
  const bootstrapIssues = getDatabaseBootstrapIssues()
  if (bootstrapIssues.length > 0) return { status: "unavailable", bootstrapIssues }

  try {
    await db.execute(sql`select 1 from ${rateLimit} limit 0`)
  } catch (error) {
    if (isMissingTableError(error)) return { status: "migrations-required" }
    throw error
  }

  const session = await getOperatorSession()
  if (!session) return { status: "signed-out" }

  const [
    { CONFIG_DEFINITIONS, configEnvironmentVariable, environmentConfigOverrideKeys },
    { getGlobalConfigState },
  ] = await Promise.all([
    import("@/lib/config/registry.server"),
    import("@/lib/config/runtime.server"),
  ])
  const configState = await withConfigureError(
    "Configuration could not be loaded",
    getGlobalConfigState,
  )
  const { issues, rows, values: effectiveValues } = configState
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
    setupComplete: issues.length === 0,
    fields,
    issues,
  }
}
