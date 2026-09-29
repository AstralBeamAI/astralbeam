import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { EmailProviderConnectionInputSchema } from "@/emails/schema"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"

type EmailProviderConnectionInput = typeof EmailProviderConnectionInputSchema.Type

/** Loads only the selected provider, matching `sendEmail`. */
const testConnection = Effect.fnUntraced(function* (input: EmailProviderConnectionInput) {
  switch (input.provider) {
    case "smtp": {
      const smtp = yield* Effect.promise(() => import("@/emails/providers/smtp"))
      return yield* Effect.tryPromise(() => smtp.testConnection(input.settings))
    }
    case "resend": {
      const resend = yield* Effect.promise(() => import("@/emails/providers/resend"))
      return yield* Effect.tryPromise(() => resend.testConnection(input.settings))
    }
    case "ses": {
      const ses = yield* Effect.promise(() => import("@/emails/providers/ses"))
      return yield* Effect.tryPromise(() => ses.testConnection(input.settings))
    }
  }
}, Effect.orDie)

/** Returns the provider's own verdict, which the page shows beside the email settings. */
export const testEmailProviderConnection = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(EmailProviderConnectionInputSchema, strictParseOptions))
  .handler(({ data, serverFnMeta }) => runEffect(testConnection(data), serverFnMeta.name))
