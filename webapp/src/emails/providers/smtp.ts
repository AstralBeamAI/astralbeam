import nodemailer from "nodemailer"
import { Schema } from "effect"
import { getGlobalConfig } from "../../lib/config/index.ts"
import {
  runConnectionTest,
  type SmtpProviderSettings,
  SmtpProviderSettingsSchema,
  type TestConnection,
} from "../schema.ts"
import { nodemailerMessage } from "../utils.server.ts"
import type { SendProviderEmail } from "../utils.server.ts"

function createSmtpTransport(settings: SmtpProviderSettings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_security === "tls",
    ...settings.smtp_security === "none" ? { ignoreTLS: true } : {},
    ...settings.smtp_security === "starttls" ? { requireTLS: true } : {},
    ...settings.smtp_username && settings.smtp_password
      ? { auth: { user: settings.smtp_username, pass: settings.smtp_password } }
      : {},
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
}

export const testConnection: TestConnection<SmtpProviderSettings> = (settings) => {
  const transport = createSmtpTransport(settings)
  return runConnectionTest(async () => {
    try {
      await transport.verify()
    } finally {
      transport.close()
    }
  })
}

export const sendSmtpEmail: SendProviderEmail = async (input) => {
  const [smtp_host, smtp_port, smtp_security, smtp_username, smtp_password] = await Promise.all([
    getGlobalConfig("smtp_host"),
    getGlobalConfig("smtp_port"),
    getGlobalConfig("smtp_security"),
    getGlobalConfig("smtp_username"),
    getGlobalConfig("smtp_password"),
  ])
  const settings = Schema.decodeUnknownSync(SmtpProviderSettingsSchema)({
    smtp_host,
    smtp_port,
    smtp_security,
    smtp_username,
    smtp_password,
  })
  const transport = createSmtpTransport(settings)
  const result = await transport.sendMail(nodemailerMessage(input))
  return { messageId: result.messageId }
}
