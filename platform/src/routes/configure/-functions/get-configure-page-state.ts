import { createServerFn } from "@tanstack/react-start"
import { Effect, Option } from "effect"

import {
  getDatabaseBootstrapIssues,
  getDatabaseEncryptionKeyring,
} from "@/db/lib/database-credentials.server"
import { Config } from "@/lib/config/config.server"
import { CONFIG_DEFINITIONS, configEnvironmentVariable } from "@/lib/config/registry.server"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { checkConfigureRequest } from "../-lib/configure-request.server"
import { readOperatorSession } from "../-lib/operator-session.server"
import type { ConfigureField, ConfigurePageState } from "../-lib/types"

const readConfigurePageState = Effect.fnUntraced(function* () {
  const session = yield* readOperatorSession()
  if (Option.isNone(session)) return { status: "signed-out" } satisfies ConfigurePageState
  const { snapshot, migrations, setupComplete } = yield* Effect.flatMap(
    Config,
    (config) => config.setupState,
  )
  const rowsByKey = new Map((snapshot.rows ?? []).map((row) => [row.key, row]))
  const fields: ConfigureField[] = CONFIG_DEFINITIONS.filter(
    (definition) => !definition.systemManaged,
  ).map((definition) => {
    const row = rowsByKey.get(definition.key)
    const source = snapshot.environmentKeys.has(definition.key) ? "environment" : "database"
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
          ? snapshot.values[definition.key] !== undefined
          : row !== undefined,
      ...(row?.storageStatus ? { storageStatus: row.storageStatus } : {}),
      // A secret never leaves with the page; `isSet` drives the masked state and
      // `revealConfigValue` fetches the one value an operator asks to see.
      value: definition.kind === "secret" ? null : (snapshot.values[definition.key] ?? null),
    }
  })
  const onboarding =
    migrations.pending.length === 0
      ? yield* Effect.flatMap(Dogfood, (dogfood) => dogfood.onboarding(snapshot.values))
      : null
  return {
    status: "ready",
    onboarding,
    sessionExpiresAt: session.value.expiresAt.toISOString(),
    fallbackEncryptionKeyCount: getDatabaseEncryptionKeyring().length - 1,
    setupComplete,
    migrations: {
      pending: migrations.pending.map(({ name, sql, hash }) => ({ name, sql, hash })),
      appliedCount: migrations.appliedCount,
    },
    fields,
    issues: [...snapshot.issues],
  } satisfies ConfigurePageState
})

export const getConfigurePageState = createServerFn({ method: "GET" }).handler(
  ({ serverFnMeta }): Promise<ConfigurePageState> | ConfigurePageState => {
    const request = checkConfigureRequest()
    // Without these variables no Effect can run, so the page explains them before anything else.
    const bootstrapIssues = getDatabaseBootstrapIssues()
    if (bootstrapIssues.length > 0) return { status: "unavailable", bootstrapIssues }
    return runEffect(
      request.pipe(
        Effect.andThen(readConfigurePageState()),
        Effect.catchTag(["ConfigureHttpsRequired", "ConfigureRequestForbidden"], exposeError),
      ),
      serverFnMeta.name,
    )
  },
)
