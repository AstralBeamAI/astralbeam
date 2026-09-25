import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import { updateGlobalConfig } from "@/lib/config/update.server"
import { findConfigDefinition } from "@/lib/config/registry.server"
import { withConfigureError } from "../-lib/configure-error.server"
import { configureMiddleware } from "../-lib/configure-middleware"
import { toValidationSchema, NonEmptyStringSchema } from "@/lib/schemas"

const GenerateConfigValueInput = Schema.Struct({
  key: NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(128))),
})

type GenerateConfigValueResult = { ok: true } | { ok: false; error: string }

export const generateConfigValue = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(GenerateConfigValueInput))
  .handler(async ({ data }): Promise<GenerateConfigValueResult> => {
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
