import process from "node:process"

import { createElement } from "react"
import { APP_LOGO_LIGHT_PNG_URL, APP_NAME } from "../lib/constants.ts"
import { getGlobalConfig } from "@/lib/config"
import { truncateEmailGraphemes } from "./email-text.ts"
import type { SendEmailOptions, SendEmailResult } from "./types.ts"
import EmailVerificationEmail from "./templates/email-verification.tsx"
import OrganizationInvitationEmail from "./templates/organization-invitation.tsx"
import PasswordChangedEmail from "./templates/password-changed.tsx"
import ResetPasswordEmail from "./templates/reset-password.tsx"
import { buildProviderEmailInput, providerLoaders, resolveProvider } from "./utils.server.ts"
import "@tanstack/react-start/server-only"

const AUTH_EMAIL_DELIVERY_ERROR = "Unable to deliver authentication email"

interface AuthEmailContext {
  appBaseUrl: string
  logoURL: string
}

// Templates cannot resolve relative paths, so links and logos need the configured absolute origin.
async function authEmailContext(): Promise<AuthEmailContext> {
  const appBaseUrl = await getGlobalConfig("app_base_url")
  if (!appBaseUrl) throw new Error("Application base URL is not configured")
  return {
    appBaseUrl,
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, appBaseUrl).href,
  }
}

interface BetterAuthLinkEmailData {
  expiresInSeconds: number
  user: { email: string }
  url: string
}

interface BetterAuthPasswordChangedEmailData {
  user: { email: string }
  changedAt?: Date | undefined
}

interface BetterAuthOrganizationInvitationEmailData {
  expiresInSeconds: number
  id: string
  email: string
  role: string
  organization: {
    name: string
    logo?: string | null | undefined
  }
  inviter: {
    user: {
      name: string
      email: string
    }
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    throw new Error("Email delivery is disabled during tests")
  }
  // TODO: Provide a local mail transport when no third-party provider is configured so Better Auth's required email flows remain usable. https://better-auth.com/docs/concepts/email
  const [emailProvider, emailFromAddress] = await Promise.all([
    getGlobalConfig("email_provider"),
    getGlobalConfig("email_from_address"),
  ])
  const provider = resolveProvider(options.provider, emailProvider ?? null)
  const input = await buildProviderEmailInput(options, emailFromAddress ?? null)
  const sendProviderEmail = await providerLoaders[provider]()
  const result = await sendProviderEmail(input)
  return { ...result, provider }
}

export async function sendVerificationEmail(data: BetterAuthLinkEmailData): Promise<void> {
  await deliverAuthEmail(({ logoURL }) => ({
    to: data.user.email,
    subject: `Verify your email on ${APP_NAME}`,
    react: createElement(EmailVerificationEmail, {
      appName: APP_NAME,
      verificationUrl: data.url,
      email: data.user.email,
      expiryMinutes: data.expiresInSeconds / 60,
      logoURL,
    }),
  }))
}

export async function sendResetPasswordEmail(data: BetterAuthLinkEmailData): Promise<void> {
  await deliverAuthEmail(({ logoURL }) => ({
    to: data.user.email,
    subject: `Reset your ${APP_NAME} password`,
    react: createElement(ResetPasswordEmail, {
      url: data.url,
      email: data.user.email,
      appName: APP_NAME,
      expirationMinutes: data.expiresInSeconds / 60,
      logoURL,
    }),
  }))
}

export async function sendPasswordChangedEmail(
  data: BetterAuthPasswordChangedEmailData,
): Promise<void> {
  await deliverAuthEmail(({ appBaseUrl, logoURL }) => {
    const recoverAccountURL = new URL("/auth/forgot-password", appBaseUrl).toString()
    return {
      to: data.user.email,
      subject: `Your ${APP_NAME} password was changed`,
      react: createElement(PasswordChangedEmail, {
        email: data.user.email,
        timestamp: formatTimestamp(data.changedAt ?? new Date()),
        recoverAccountURL,
        appName: APP_NAME,
        logoURL,
      }),
    }
  })
}

export async function sendOrganizationInvitationEmail(
  data: BetterAuthOrganizationInvitationEmailData,
): Promise<void> {
  await deliverAuthEmail(({ appBaseUrl, logoURL }) => {
    const organizationName = sanitizeSubjectPart(data.organization.name)
    const invitationRoles = formatInvitationRoles(data.role)
    const invitationURL = new URL("/auth/accept-invitation", appBaseUrl)
    invitationURL.searchParams.set("invitationId", data.id)
    return {
      to: data.email,
      subject: `You're invited to ${organizationName} on ${APP_NAME}`,
      react: createElement(OrganizationInvitationEmail, {
        url: invitationURL.toString(),
        inviterName: data.inviter.user.name,
        inviterEmail: data.inviter.user.email,
        organizationName: data.organization.name,
        role: invitationRoles,
        appName: APP_NAME,
        expirationHours: data.expiresInSeconds / (60 * 60),
        logoURL,
      }),
    }
  })
}

async function deliverAuthEmail(
  createOptions: (context: AuthEmailContext) => SendEmailOptions,
): Promise<void> {
  let options: SendEmailOptions
  try {
    options = createOptions(await authEmailContext())
  } catch {
    console.error("Authentication email preparation failed")
    throw new Error(AUTH_EMAIL_DELIVERY_ERROR)
  }

  try {
    await sendEmail(options)
  } catch {
    // Record the failure category without retaining provider responses, recipients, or token URLs.
    console.error("Authentication email provider delivery failed")
    throw new Error(AUTH_EMAIL_DELIVERY_ERROR)
  }
}

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(date)
}

function sanitizeSubjectPart(value: string): string {
  const normalized = truncateEmailGraphemes(value.replaceAll(/\s+/g, " ").trim(), 120)
  return normalized || "your organization"
}

function formatInvitationRoles(value: string): string {
  const roles = [...new Set(value.split(",").map((role) => role.trim()).filter(Boolean))]
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    roles.length > 0 ? roles : ["member"],
  )
}
