import { createElement } from "react"
import { APP_BASE_URL } from "../lib/config.server.ts"
import { APP_NAME } from "../lib/config.ts"
import EmailVerificationEmail from "./templates/email-verification.tsx"
import type { EmailProvider, SendEmailOptions, SendEmailResult } from "./types.ts"
import { buildProviderEmailInput, providerLoaders, resolveProvider } from "./utils.server.ts"
import "@tanstack/react-start/server-only"

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const provider = resolveProvider(options.provider)
  const input = await buildProviderEmailInput(options)
  const { sendProviderEmail } = await providerLoaders[provider]()
  const result = await sendProviderEmail(input)
  return { ...result, provider }
}

export async function sendVerificationEmail(options: {
  to: string
  from?: string | undefined
  replyTo?: string | string[] | undefined
  provider?: EmailProvider | undefined
  verificationUrl: string
  expiryMinutes: number
}): Promise<SendEmailResult> {
  return await sendEmail({
    to: options.to,
    from: options.from,
    replyTo: options.replyTo,
    provider: options.provider,
    subject: `Verify your email on ${APP_NAME}`,
    react: createElement(EmailVerificationEmail, {
      logoUrl: `${APP_BASE_URL}/astralbeam-logo-light.png`,
      verificationUrl: options.verificationUrl,
      expiryMinutes: options.expiryMinutes,
      email: options.to,
    }),
  })
}
