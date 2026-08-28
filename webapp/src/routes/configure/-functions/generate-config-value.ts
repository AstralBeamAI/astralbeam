import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

const GenerateConfigValueInput = Schema.Struct({
  key: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
})

interface GenerateConfigValueResult {
  ok: boolean
  error?: string
}

export const generateConfigValue = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(GenerateConfigValueInput))
  .handler(async ({ data }): Promise<GenerateConfigValueResult> => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { findConfigDefinition } = await import("@/lib/config/registry.server")
    const { updateGlobalConfig } = await import("@/lib/config/update.server")
    const { withConfigureError } = await import("../-lib/configure-error.server")
    requireConfigureRequest()
    if (!await getOperatorSession()) {
      return { ok: false, error: "Operator authentication required" }
    }
    const definition = findConfigDefinition(data.key)
    const generate = definition?.generate
    if (!definition || !generate) {
      return { ok: false, error: "This configuration value cannot be generated" }
    }
    const result = await withConfigureError(
      "The configuration value could not be generated",
      () => updateGlobalConfig([{ key: definition.key, value: generate() }]),
    )
    return result.ok ? { ok: true } : {
      ok: false,
      error: result.fieldErrors[0]?.message ?? "The configuration value could not be generated",
    }
  })
