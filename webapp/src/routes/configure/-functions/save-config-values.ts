import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import type { ConfigureIssue } from "../-lib/types"

const SaveConfigValuesInput = Schema.Struct({
  updates: Schema.Array(Schema.Struct({
    key: Schema.NonEmptyString,
    // `null` clears an optional value.
    value: Schema.NullOr(Schema.String),
  })),
})

export interface SaveConfigValuesResult {
  ok: boolean
  fieldErrors: ConfigureIssue[]
  warnings: ConfigureIssue[]
}

export const saveConfigValues = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveConfigValuesInput))
  .handler(async ({ data }): Promise<SaveConfigValuesResult> => {
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const {
      configDefinition,
      decodeStoredConfigValues,
      invalidateConfigCache,
      validateConfigCompleteness,
    } = await import("@/lib/config.server")
    const { deleteConfigValue, listConfigRows, upsertConfigValue } = await import(
      "../-lib/db.server"
    )
    const session = await getOperatorSession()
    if (!session) {
      return {
        ok: false,
        fieldErrors: [{ key: "", message: "Operator authentication required" }],
        warnings: [],
      }
    }

    const fieldErrors: ConfigureIssue[] = []
    for (const update of data.updates) {
      const definition = configDefinition(update.key)
      if (!definition) {
        fieldErrors.push({ key: update.key, message: "Unknown configuration key" })
        continue
      }
      if (update.value === null) {
        await deleteConfigValue(definition.key)
        continue
      }
      let decoded: string
      try {
        decoded = definition.decode(update.value)
      } catch (error) {
        fieldErrors.push({
          key: definition.key,
          message: error instanceof Error ? error.message : "Invalid value",
        })
        continue
      }
      await upsertConfigValue({
        key: definition.key,
        value: decoded,
        updatedBy: session.dbUsername,
      })
    }
    invalidateConfigCache()
    const rows = await listConfigRows()
    const warnings = validateConfigCompleteness(decodeStoredConfigValues(rows ?? []))
    return { ok: fieldErrors.length === 0, fieldErrors, warnings }
  })
