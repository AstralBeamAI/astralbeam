import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

const ApplyMigrationsInput = Schema.Struct({
  approvedMigrations: Schema.Array(Schema.Struct({
    name: Schema.NonEmptyString,
    hash: Schema.NonEmptyString,
  })),
})

interface ApplyMigrationsActionResult {
  ok: boolean
  error?: string
}

export const applyMigrations = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ApplyMigrationsInput))
  .handler(async ({ data }): Promise<ApplyMigrationsActionResult> => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { applyApprovedMigrations } = await import("@/db/migration-runner.server")
    const { invalidateGlobalConfig } = await import("@/lib/config/runtime.server")
    const { withConfigureError } = await import("../-lib/configure-error.server")
    requireConfigureRequest()
    if (!await getOperatorSession()) {
      return { ok: false, error: "Operator authentication required" }
    }
    const result = await withConfigureError(
      "Pending migrations could not be applied",
      async () => {
        try {
          return await applyApprovedMigrations([...data.approvedMigrations])
        } finally {
          invalidateGlobalConfig()
        }
      },
    )
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  })
