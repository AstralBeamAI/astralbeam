import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { Config } from "@/lib/config/config"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"

const RevealConfigValueInput = Schema.Struct({
  key: NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(128))),
})

/**
 * Returns one decrypted secret. A read, but POST so the middleware's same-origin check, which
 * exempts safe methods, applies here too.
 */
export const revealConfigValue = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(RevealConfigValueInput))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Config, (config) => config.reveal(data.key)).pipe(
        Effect.catchTag("ConfigValueNotRevealable", exposeError),
      ),
      serverFnMeta.name,
    ),
  )
