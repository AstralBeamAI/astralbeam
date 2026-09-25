import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import { EmailProviderConnectionInputSchema, emailProviderParseOptions } from "@/emails/schema"
import { configureMiddleware } from "../-lib/configure-middleware"

export const testEmailProviderConnection = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(
    Schema.toStandardSchemaV1(EmailProviderConnectionInputSchema, {
      parseOptions: emailProviderParseOptions,
    }),
  )
  .handler(async ({ data }) => {
    switch (data.provider) {
      case "smtp":
        return await (await import("@/emails/providers/smtp")).testConnection(data.settings)
      case "resend":
        return await (await import("@/emails/providers/resend")).testConnection(data.settings)
      case "ses":
        return await (await import("@/emails/providers/ses")).testConnection(data.settings)
    }
  })
