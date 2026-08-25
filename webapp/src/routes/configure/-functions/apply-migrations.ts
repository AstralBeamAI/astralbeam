import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

const ApplyMigrationsInput = Schema.Struct({
  approvedNames: Schema.Array(Schema.NonEmptyString),
})

export interface ApplyMigrationsActionResult {
  ok: boolean
  error?: string
}

export const applyMigrations = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ApplyMigrationsInput))
  .handler(async ({ data }): Promise<ApplyMigrationsActionResult> => {
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { applyPendingMigrations } = await import("../-lib/migrations.server")
    const session = await getOperatorSession()
    if (!session) return { ok: false, error: "Operator authentication required" }
    const result = await applyPendingMigrations([...data.approvedNames])
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  })
