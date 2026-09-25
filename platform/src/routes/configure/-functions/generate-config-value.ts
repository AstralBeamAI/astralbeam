import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import { configureMiddleware } from "../-lib/configure-middleware"

const GenerateConfigValueInput = Schema.Struct({
  key: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
})

interface GenerateConfigValueResult {
  ok: boolean
  error?: string
}

export const generateConfigValue = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(Schema.toStandardSchemaV1(GenerateConfigValueInput))
  .handler(async ({ data }): Promise<GenerateConfigValueResult> => {
    const { findConfigDefinition } = await import("@/lib/config/registry.server")
    const { updateGlobalConfig } = await import("@/lib/config/update.server")
    const { withConfigureError } = await import("../-lib/configure-error.server")
    const definition = findConfigDefinition(data.key)
    const generate = definition?.generate
    if (!definition || definition.systemManaged || !generate) {
      return { ok: false, error: "This configuration value cannot be generated" }
    }
    const result = await withConfigureError("The configuration value could not be generated", () =>
      updateGlobalConfig([{ key: definition.key, value: generate() }]),
    )
    return result.ok
      ? { ok: true }
      : {
          ok: false,
          error: result.fieldErrors[0]?.message ?? "The configuration value could not be generated",
        }
  })
