import { Buffer } from "node:buffer"

import { Effect } from "effect"
import { Resend } from "resend"

import { errorReason } from "@/lib/runtime/failure-report.server"
import { EmailConnectionFailed, EmailDeliveryError } from "../errors.ts"
import type { ResendProviderSettings } from "../schemas.ts"
import { emailConnectionCheck, emailProviderCall, type ProviderEmail } from "./providers.ts"

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
          cc: [...email.cc],
          subject: email.subject,
          html: email.html,
          text: email.text,
          replyTo: email.replyTo,
          attachments: email.attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            content: Buffer.from(attachment.content),
          })),
        }),
      ).pipe(
        Effect.flatMap(({ data, error }) =>
          error
            ? Effect.fail(new EmailDeliveryError({ reason: errorReason(error) }))
            : Effect.succeed(data?.id),
        ),
      )
  })
