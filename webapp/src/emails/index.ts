import process from "node:process"

import { createElement } from "react"
import { APP_BASE_URL } from "../lib/config.server.ts"
import { APP_LOGO_DARK_PNG_URL, APP_LOGO_LIGHT_PNG_URL, APP_NAME } from "../lib/config.ts"
import type { SendEmailOptions, SendEmailResult } from "./types.ts"
import EmailVerificationEmail from "./templates/email-verification.tsx"
import OrganizationInvitationEmail from "./templates/organization-invitation.tsx"
import PasswordChangedEmail from "./templates/password-changed.tsx"
import ResetPasswordEmail from "./templates/reset-password.tsx"
import { buildProviderEmailInput, providerLoaders, resolveProvider } from "./utils.server.ts"
import "@tanstack/react-start/server-only"

const AUTH_EMAIL_DELIVERY_ERROR = "Unable to deliver authentication email"
const EMAIL_LINK_EXPIRY_MINUTES = 60
const ORGANIZATION_INVITATION_EXPIRY_HOURS = 48

const logoURL = {
  light: new URL(APP_LOGO_LIGHT_PNG_URL, APP_BASE_URL).href,
  dark: new URL(APP_LOGO_DARK_PNG_URL, APP_BASE_URL).href,
}

export interface BetterAuthLinkEmailData {
  user: { email: string }
  url: string
}

export interface BetterAuthPasswordChangedEmailData {
  user: { email: string }
  changedAt?: Date | undefined
}

export interface BetterAuthOrganizationInvitationEmailData {
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
  const provider = resolveProvider(options.provider)
  const input = await buildProviderEmailInput(options)
  const { sendProviderEmail } = await providerLoaders[provider]()
  const result = await sendProviderEmail(input)
  return { ...result, provider }
}

export async function sendVerificationEmail(data: BetterAuthLinkEmailData): Promise<void> {
  await deliverAuthEmail(() => ({
    to: data.user.email,
    subject: `Verify your email on ${APP_NAME}`,
    react: createElement(EmailVerificationEmail, {
      appName: APP_NAME,
      verificationUrl: data.url,
      email: data.user.email,
      expiryMinutes: EMAIL_LINK_EXPIRY_MINUTES,
      logoURL,
    }),
  }))
}

export async function sendResetPasswordEmail(data: BetterAuthLinkEmailData): Promise<void> {
  await deliverAuthEmail(() => ({
    to: data.user.email,
    subject: `Reset your ${APP_NAME} password`,
    react: createElement(ResetPasswordEmail, {
      url: data.url,
      email: data.user.email,
      appName: APP_NAME,
      expirationMinutes: EMAIL_LINK_EXPIRY_MINUTES,
      logoURL,
    }),
  }))
}

export async function sendPasswordChangedEmail(
  data: BetterAuthPasswordChangedEmailData,
): Promise<void> {
  await deliverAuthEmail(() => {
    const secureAccountURL = new URL("/settings/security", APP_BASE_URL).toString()
    return {
      to: data.user.email,
      subject: `Your ${APP_NAME} password was changed`,
      react: createElement(PasswordChangedEmail, {
        email: data.user.email,
        timestamp: formatTimestamp(data.changedAt ?? new Date()),
        secureAccountURL,
        appName: APP_NAME,
        logoURL,
      }),
    }
  })
}

export async function sendOrganizationInvitationEmail(
  data: BetterAuthOrganizationInvitationEmailData,
): Promise<void> {
  await deliverAuthEmail(() => {
    const organizationName = sanitizeSubjectPart(data.organization.name)
    return {
      to: data.email,
      subject: `You're invited to ${organizationName} on ${APP_NAME}`,
      react: createElement(OrganizationInvitationEmail, {
        url: new URL("/settings/organizations", APP_BASE_URL).toString(),
        email: data.email,
        inviterName: data.inviter.user.name,
        inviterEmail: data.inviter.user.email,
        organizationName: data.organization.name,
        role: data.role,
        appName: APP_NAME,
        expirationHours: ORGANIZATION_INVITATION_EXPIRY_HOURS,
        logoURL,
      }),
    }
  })
}

async function deliverAuthEmail(createOptions: () => SendEmailOptions): Promise<void> {
  let options: SendEmailOptions
  try {
    options = createOptions()
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
  const normalized = value.replaceAll(/\s+/g, " ").trim().slice(0, 120)
  return normalized || "your organization"
}
