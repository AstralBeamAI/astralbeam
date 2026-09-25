import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import { applyApprovedMigrations } from "@/db/migration-runner.server"
import { invalidateGlobalConfig } from "@/lib/config/runtime.server"
import { withConfigureError } from "../-lib/configure-error.server"
import { configureMiddleware } from "../-lib/configure-middleware"

const ApplyMigrationsInput = Schema.Struct({
  approvedMigrations: Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      hash: Schema.NonEmptyString,
    }),
  ),
})

interface ApplyMigrationsActionResult {
  ok: boolean
  error?: string
}

export const applyMigrations = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(Schema.toStandardSchemaV1(ApplyMigrationsInput))
  .handler(async ({ data }): Promise<ApplyMigrationsActionResult> => {
    const result = await withConfigureError("Pending migrations could not be applied", async () => {
      try {
        return await applyApprovedMigrations([...data.approvedMigrations])
      } finally {
        invalidateGlobalConfig()
      }
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  })
