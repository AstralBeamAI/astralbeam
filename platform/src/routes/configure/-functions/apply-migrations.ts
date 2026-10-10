import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { Config } from "@/lib/config/config"
import { provideClusterWorkflowEngine } from "@/lib/cluster/runtime"
import { modelPriceCatalogInitialization } from "@/lib/workflows/model-price-catalog-refresh"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"

const ApplyMigrationsInput = Schema.Struct({
  approvedMigrations: Schema.Array(NonEmptyStringSchema),
})

export const applyMigrations = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(ApplyMigrationsInput))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const config = yield* Config
        yield* config.applyMigrations(data.approvedMigrations)
        yield* modelPriceCatalogInitialization
          .execute({}, { discard: true })
          .pipe(provideClusterWorkflowEngine)
      }).pipe(Effect.catchTag("MigrationsNotApplied", exposeError)),
      serverFnMeta.name,
    ),
  )
