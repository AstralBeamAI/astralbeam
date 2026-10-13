import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { Config } from "@/lib/config/config"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"

const GenerateConfigValueInput = Schema.Struct({
  key: NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(128))),
})

export const generateConfigValue = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(GenerateConfigValueInput))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const config = yield* Config
        const dogfood = yield* Dogfood
        yield* dogfood.withProvisioningLock(config.generate(data.key))
      }).pipe(Effect.catchTag(["ConfigValueNotGeneratable", "ConfigurationBusy"], exposeError)),
      serverFnMeta.name,
    ),
  )
