import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { Config } from "@/lib/config/config.server"
import { provideClusterWorkflowEngine } from "@/lib/cluster/runtime.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { modelPriceCatalogInitialization } from "@/lib/workflows/model-price-catalog-refresh.server"
import { configureMiddleware } from "../-lib/configure-middleware"

const ApplyMigrationsInput = Schema.Struct({
  approvedMigrations: Schema.Array(
    Schema.Struct({
      name: NonEmptyStringSchema,
      hash: NonEmptyStringSchema,
    }),
  ),
})

export const applyMigrations = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(ApplyMigrationsInput))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const config = yield* Config
        yield* config.applyMigrations(data.approvedMigrations)
        if (
          (yield* config.setupState).setupComplete &&
          !(yield* config.readModelPriceCatalog)?.fetchedAt
        ) {
          yield* modelPriceCatalogInitialization.execute({}, { discard: true }).pipe(
            provideClusterWorkflowEngine,
            Effect.catchCause(() =>
              Effect.logWarning(
                "Initial pricing catalog submission failed. Daily refresh remains scheduled",
              ),
            ),
          )
        }
      }).pipe(Effect.catchTag("MigrationsNotApplied", exposeError)),
      serverFnMeta.name,
    ),
  )
