import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

const RotateAuthSecretInput = Schema.Struct({
  key: Schema.Literals(["better_auth_secret", "chat_auth_secret"]),
})

export interface RotateAuthSecretResult {
  ok: boolean
  error?: string
}

export const rotateAuthSecret = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(RotateAuthSecretInput))
  .handler(async ({ data }): Promise<RotateAuthSecretResult> => {
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { configDefinition, invalidateConfigCache } = await import("@/lib/config.server")
    const { upsertConfigValue } = await import("../-lib/db.server")
    const session = await getOperatorSession()
    if (!session) return { ok: false, error: "Operator authentication required" }
    const definition = configDefinition(data.key)
    if (!definition?.generate) return { ok: false, error: "This value cannot be generated" }
    await upsertConfigValue({
      key: definition.key,
      value: definition.generate(),
      updatedBy: session.dbUsername,
    })
    invalidateConfigCache()
    return { ok: true }
  })
