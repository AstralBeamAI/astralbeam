import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { Config } from "@/lib/config/config.server"
import { provideClusterWorkflowEngine } from "@/lib/cluster/runtime.server"
import { modelPriceCatalogInitialization } from "@/lib/workflows/model-price-catalog-refresh.server"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import { OwnerOnboardingInput } from "@/lib/dogfood/schemas"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"
import type { ConfigureFieldError } from "../-lib/types"

const SaveConfigValuesInput = Schema.Struct({
  onboarding: Schema.optional(OwnerOnboardingInput),
  updates: Schema.Array(
    Schema.Struct({
      key: NonEmptyStringSchema,
      // `null` clears an optional value.
      value: Schema.NullOr(Schema.String),
    }),
  ),
})

/** Returns the values it refused beside their fields. Every other failure is thrown. */
export const saveConfigValues = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(SaveConfigValuesInput))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const config = yield* Config
        const dogfood = yield* Dogfood
        const sql = yield* SqlClient.SqlClient
        yield* dogfood.withProvisioningLock(
          Effect.gen(function* () {
            const needsOnboarding = !(yield* config.get("dogfood_organization_id"))
            yield* sql
              .withTransaction(
                config
                  .update(data.updates)
                  .pipe(
                    Effect.andThen(modelPriceCatalogInitialization.execute({}, { discard: true })),
                    provideClusterWorkflowEngine,
                  ),
              )
              .pipe(Effect.ensuring(config.invalidate))
            if (needsOnboarding && data.onboarding) yield* dogfood.provision(data.onboarding)
          }),
        )
        return { fieldErrors: [] as readonly ConfigureFieldError[] }
      }).pipe(
        Effect.catchTag("ConfigUpdateInvalid", (error) =>
          Effect.succeed({ fieldErrors: error.issues }),
        ),
        Effect.catchTag(["OwnerOnboardingFailed", "ConfigurationBusy"], exposeError),
      ),
      serverFnMeta.name,
    ),
  )
