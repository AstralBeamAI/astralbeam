import { Effect } from "effect"
import { Resend } from "resend"

import { EmailConnectionFailed, EmailDeliveryError } from "../errors.ts"
import type { ResendProviderSettings } from "../schemas.ts"
import {
  emailConnectionCheck,
  emailFailureReason,
  emailProviderCall,
  type ProviderEmail,
} from "./providers.server.ts"

export const testConnection = (settings: ResendProviderSettings) =>
  emailConnectionCheck(() => new Resend(settings.resend_api_key).domains.list({ limit: 1 })).pipe(
    Effect.flatMap(({ error }) =>
      // Sending-only keys are valid but cannot list domains. https://resend.com/docs/api-reference/api-keys/create-api-key
      error && error.name !== "restricted_api_key"
        ? Effect.fail(new EmailConnectionFailed({ message: error.message }))
        : Effect.void,
    ),
  )

// The client only stores the key and sends over global fetch, so it holds nothing to release.
export const acquireSender = (settings: ResendProviderSettings) =>
  Effect.sync(() => {
    const resend = new Resend(settings.resend_api_key)
    return (email: ProviderEmail) =>
      emailProviderCall(() =>
        resend.emails.send({
          from: email.from,
          to: [...email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          replyTo: email.from,
        }),
      ).pipe(
        Effect.flatMap(({ data, error }) =>
          error
            ? Effect.fail(new EmailDeliveryError({ reason: emailFailureReason(error) }))
            : Effect.succeed(data?.id),
        ),
      )
  })
