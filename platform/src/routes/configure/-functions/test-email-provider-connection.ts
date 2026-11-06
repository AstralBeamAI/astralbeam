import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"

import { Mailer } from "@/lib/email/email.server"
import { EmailProviderConnectionInputSchema } from "@/lib/email/schemas"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { configureMiddleware } from "../-lib/configure-middleware"

export const testEmailProviderConnection = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(EmailProviderConnectionInputSchema, strictParseOptions))
  .handler(
    effectHandler(({ data }) => Effect.flatMap(Mailer, (mailer) => mailer.testConnection(data))),
  )
