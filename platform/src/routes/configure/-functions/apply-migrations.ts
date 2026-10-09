import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { Config } from "@/lib/config/config.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"
import { initializeModelPriceCatalog } from "../-lib/initialize-model-price-catalog.server"

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
        yield* initializeModelPriceCatalog
      }).pipe(Effect.catchTag("MigrationsNotApplied", exposeError)),
      serverFnMeta.name,
    ),
  )
