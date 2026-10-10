import { Buffer } from "node:buffer"

import { Effect } from "effect"
import nodemailer from "nodemailer"

import type { SmtpProviderSettings } from "../schemas.ts"
import { emailConnectionCheck, emailProviderCall, type ProviderEmail } from "./providers.ts"

function createSmtpTransport(settings: SmtpProviderSettings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_security === "tls",
    ...(settings.smtp_security === "none" ? { ignoreTLS: true } : {}),
    ...(settings.smtp_security === "starttls" ? { requireTLS: true } : {}),
    ...(settings.smtp_username && settings.smtp_password
      ? { auth: { user: settings.smtp_username, pass: settings.smtp_password } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
}

function acquireSmtpTransport(settings: SmtpProviderSettings) {
  return Effect.acquireRelease(
    Effect.sync(() => createSmtpTransport(settings)),
    (transport) => Effect.sync(() => transport.close()),
  )
}

export const testConnection = (settings: SmtpProviderSettings) =>
  Effect.scoped(
    Effect.flatMap(acquireSmtpTransport(settings), (transport) =>
      emailConnectionCheck(() => transport.verify()),
    ),
  )

export const acquireSender = (settings: SmtpProviderSettings) =>
  Effect.map(
    acquireSmtpTransport(settings),
    (transport) => (email: ProviderEmail) =>
      emailProviderCall(() =>
        transport.sendMail({
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
      ).pipe(Effect.map((result) => result.messageId)),
  )
