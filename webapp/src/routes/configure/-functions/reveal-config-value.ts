import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

const RevealConfigValueInput = Schema.Struct({
  key: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
})

type RevealConfigValueResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

/**
 * Returns one decrypted secret. A read, but POST so `requireConfigureRequest`, which exempts safe
 * methods from its same-origin check, applies it here too; that call also sets `no-store`.
 */
export const revealConfigValue = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RevealConfigValueInput))
  .handler(async ({ data }): Promise<RevealConfigValueResult> => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { findConfigDefinition } = await import("@/lib/config/registry.server")
    const { getGlobalConfig } = await import("@/lib/config")
    const { withConfigureError } = await import("../-lib/configure-error.server")
    requireConfigureRequest()
    if (!await getOperatorSession()) {
      return { ok: false, error: "Operator authentication required" }
    }
    const definition = findConfigDefinition(data.key)
    if (!definition || definition.kind !== "secret") {
      return { ok: false, error: "This configuration value cannot be revealed" }
    }
    const value = await withConfigureError(
      "The configuration value could not be read",
      () => getGlobalConfig(definition.key),
    )
    return { ok: true, value: value ?? null }
  })
