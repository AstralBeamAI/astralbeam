import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import { EmailProviderConnectionInputSchema } from "@/emails/schema"

export const testEmailProviderConnection = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(EmailProviderConnectionInputSchema))
  .handler(async ({ data }) => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    requireConfigureRequest()
    if (!await getOperatorSession()) {
      return { ok: false, error: "Operator authentication required" } as const
    }

    switch (data.provider) {
      case "smtp":
        return await (await import("@/emails/providers/smtp")).testConnection(data.settings)
      case "resend":
        return await (await import("@/emails/providers/resend")).testConnection(data.settings)
      case "ses":
        return await (await import("@/emails/providers/ses")).testConnection(data.settings)
    }
  })
