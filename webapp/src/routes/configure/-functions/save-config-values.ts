import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import type { ConfigureFieldError } from "../-lib/types"
import { OwnerOnboardingInput } from "@/lib/dogfood/schema"
import { configureMiddleware } from "../-lib/configure-middleware"

const SaveConfigValuesInput = Schema.Struct({
  onboarding: Schema.optional(OwnerOnboardingInput),
  updates: Schema.Array(
    Schema.Struct({
      key: Schema.NonEmptyString,
      // `null` clears an optional value.
      value: Schema.NullOr(Schema.String),
    }),
  ),
})

type SaveConfigValuesResult =
  | { ok: true }
  | { ok: false; error?: string; fieldErrors: readonly ConfigureFieldError[] }

export const saveConfigValues = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(Schema.toStandardSchemaV1(SaveConfigValuesInput))
  .handler(async ({ data }): Promise<SaveConfigValuesResult> => {
    const { updateGlobalConfig } = await import("@/lib/config/update.server")
    const { withConfigureError } = await import("../-lib/configure-error.server")

    return withConfigureError(
      "Configuration could not be saved",
      async (): Promise<SaveConfigValuesResult> => {
        const { getGlobalConfig } = await import("@/lib/config")
        const needsOnboarding = !(await getGlobalConfig("dogfood_organization_id"))
        if (needsOnboarding && !data.onboarding) {
          return {
            ok: false,
            error: "Owner email and dogfood organization are required",
            fieldErrors: [],
          }
        }
        const saved = await updateGlobalConfig(data.updates)
        if (!saved.ok || !needsOnboarding) return saved
        const { provisionDogfoodResources } = await import("@/lib/dogfood/provisioning.server")
        const { runDatabaseEffect } = await import("@/db")
        const { Effect } = await import("effect")
        return runDatabaseEffect(
          provisionDogfoodResources(data.onboarding!).pipe(
            Effect.as({ ok: true } as const),
            Effect.catchTag("OwnerOnboardingError", (error) =>
              Effect.succeed({ ok: false, error: error.message, fieldErrors: [] } as const),
            ),
          ),
        )
      },
    )
  })
