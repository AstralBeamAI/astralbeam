import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { updateGlobalConfig } from "@/lib/config/update.server"
import { getGlobalConfig } from "@/lib/config"
import { provisionDogfoodResources } from "@/lib/dogfood/provisioning.server"
import { runDatabaseEffect } from "@/db"
import { withConfigureError } from "../-lib/configure-error.server"
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
    return withConfigureError(
      "Configuration could not be saved",
      async (): Promise<SaveConfigValuesResult> => {
        const needsOnboarding = !(await getGlobalConfig("dogfood_organization_id"))
        const saved = await updateGlobalConfig(data.updates)
        if (!saved.ok || !needsOnboarding || !data.onboarding) return saved
        return runDatabaseEffect(
          provisionDogfoodResources(data.onboarding).pipe(
            Effect.as({ ok: true } as const),
            Effect.catchTag("OwnerOnboardingError", (error) =>
              Effect.succeed({ ok: false, error: error.message, fieldErrors: [] } as const),
            ),
          ),
        )
      },
    )
  })
