import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import type { ConfigureFieldError } from "../-lib/types"

const SaveConfigValuesInput = Schema.Struct({
  updates: Schema.Array(Schema.Struct({
    key: Schema.NonEmptyString,
    // `null` clears an optional value.
    value: Schema.NullOr(Schema.String),
  })),
})

type SaveConfigValuesResult =
  | { ok: true }
  | { ok: false; error?: string; fieldErrors: ConfigureFieldError[] }

export const saveConfigValues = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SaveConfigValuesInput))
  .handler(async ({ data }): Promise<SaveConfigValuesResult> => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { updateGlobalConfig } = await import("@/lib/config/update.server")
    const { withConfigureError } = await import("../-lib/configure-error.server")
    requireConfigureRequest()
    if (!await getOperatorSession()) {
      return {
        ok: false,
        error: "Operator authentication required",
        fieldErrors: [],
      }
    }

    const result = await withConfigureError(
      "Configuration could not be saved",
      () => updateGlobalConfig(data.updates),
    )
    return result
  })
