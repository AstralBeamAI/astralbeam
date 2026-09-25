import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import { getGlobalConfig } from "@/lib/config"
import { findConfigDefinition } from "@/lib/config/registry.server"
import { withConfigureError } from "../-lib/configure-error.server"
import { configureMiddleware } from "../-lib/configure-middleware"
import { toValidationSchema, NonEmptyStringSchema } from "@/lib/schemas"

const RevealConfigValueInput = Schema.Struct({
  key: NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(128))),
})

type RevealConfigValueResult = { ok: true; value: string | null } | { ok: false; error: string }

/**
 * Returns one decrypted secret. A read, but POST so `requireConfigureRequest`, which exempts safe
 * methods from its same-origin check, applies it here too; that call also sets `no-store`.
 */
export const revealConfigValue = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(RevealConfigValueInput))
  .handler(async ({ data }): Promise<RevealConfigValueResult> => {
    const definition = findConfigDefinition(data.key)
    if (!definition || definition.systemManaged || definition.kind !== "secret") {
      return { ok: false, error: "This configuration value cannot be revealed" }
    }
    const value = await withConfigureError("The configuration value could not be read", () =>
      getGlobalConfig(definition.key),
    )
    return { ok: true, value: value ?? null }
  })
