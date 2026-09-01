import process from "node:process"

import { createElement } from "react"
import type { ReactElement } from "react"
import { APP_LOGO_LIGHT_PNG_URL, APP_NAME } from "../lib/constants.ts"
import { getGlobalConfig } from "@/lib/config"
import { truncateEmailGraphemes } from "./email-text.ts"
import type { EmailProvider } from "./schema.ts"
import AccountExistsEmail from "./templates/account-exists.tsx"
import EmailVerificationEmail from "./templates/email-verification.tsx"
import OrganizationInvitationEmail from "./templates/organization-invitation.tsx"
import PasswordChangedEmail from "./templates/password-changed.tsx"
import ResetPasswordEmail from "./templates/reset-password.tsx"
import {
  buildProviderEmailInput,
  maskEmailAddressForLog,
  providerLoaders,
  resolveDefaultFrom,
  resolveProvider,
} from "./utils.server.ts"
import "@tanstack/react-start/server-only"

const AUTH_EMAIL_DELIVERY_ERROR = "Unable to deliver authentication email"

export interface EmailAttachment {
  filename: string
  /** An HTTP(S) URL to fetch, a `data:` URI, or a bare base64-encoded payload. */
  path: string
}

export interface SendEmailOptions {
  to: string | string[]
  /** Defaults to `EMAIL_FROM_ADDRESS`, or `no-reply@<app hostname>` for SMTP. */
  from?: string | undefined
  subject: string
  /** A react-email template element; rendered to both HTML and plain text. */
  react?: ReactElement | undefined
  /** Pre-rendered HTML, used instead of `react`. */
  html?: string | undefined
  /** Plain-text alternative; derived from `react` when omitted. */
  text?: string | undefined
  /** Defaults to the resolved `from` address. */
  replyTo?: string | string[] | undefined
  attachments?: EmailAttachment[] | undefined
  /** Defaults to `EMAIL_PROVIDER`, then SMTP. */
  provider?: EmailProvider | undefined
}

export interface SendEmailResult {
  /** Provider-assigned message identifier, when the provider returns one. */
  messageId?: string | undefined
  provider: EmailProvider
}

interface AuthEmailContext {
  appBaseUrl: string
  logoURL: string
}

/** Log label identifying which authentication email a send outcome belongs to. */
type AuthEmailKind =
  | "account-exists"
  | "email-verification"
  | "organization-invitation"
  | "password-changed"
  | "reset-password"

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

interface AccountExistsEmailData {
  user: { email: string }
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
  const [appBaseUrl, emailProvider, emailFromAddress] = await Promise.all([
    getGlobalConfig("app_base_url"),
    getGlobalConfig("email_provider"),
    getGlobalConfig("email_from_address"),
  ])
  const provider = resolveProvider(options.provider, emailProvider ?? null)
  const input = await buildProviderEmailInput(
    options,
    resolveDefaultFrom(provider, emailFromAddress ?? null, appBaseUrl ?? null),
  )
  const sendProviderEmail = await providerLoaders[provider]()
  const result = await sendProviderEmail(input)
  return { ...result, provider }
}

export async function sendVerificationEmail(data: BetterAuthLinkEmailData): Promise<void> {
  await deliverAuthEmail("email-verification", ({ logoURL }) => ({
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
  await deliverAuthEmail("reset-password", ({ logoURL }) => ({
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
  await deliverAuthEmail("password-changed", ({ appBaseUrl, logoURL }) => {
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

/**
 * Sent when a sign-up names an address that already has a verified account. Better Auth answers
 * that sign-up with its synthetic-user response to avoid confirming the address exists, so this
 * email is the only thing that tells the account's real owner why their sign-up went nowhere.
 */
export async function sendAccountExistsEmail(data: AccountExistsEmailData): Promise<void> {
  await deliverAuthEmail("account-exists", ({ appBaseUrl, logoURL }) => ({
    to: data.user.email,
    subject: `Your ${APP_NAME} account already exists`,
    react: createElement(AccountExistsEmail, {
      appName: APP_NAME,
      email: data.user.email,
      logoURL,
      recoverAccountURL: new URL("/auth/forgot-password", appBaseUrl).toString(),
      signInURL: new URL("/auth/sign-in", appBaseUrl).toString(),
    }),
  }))
}

export async function sendOrganizationInvitationEmail(
  data: BetterAuthOrganizationInvitationEmailData,
): Promise<void> {
  await deliverAuthEmail("organization-invitation", ({ appBaseUrl, logoURL }) => {
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

/**
 * Every authentication email funnels through here, so this is the one place that reports the
 * outcome of a send. Both outcomes are logged with a partially masked recipient: an operator needs
 * to correlate a user's report with a specific send, and a failure additionally needs the
 * provider's own reason to fix a rejected sender or key. The rendered email and the token URL are
 * never logged.
 */
async function deliverAuthEmail(
  kind: AuthEmailKind,
  createOptions: (context: AuthEmailContext) => SendEmailOptions,
): Promise<void> {
  let options: SendEmailOptions
  try {
    options = createOptions(await authEmailContext())
  } catch {
    console.error(`Authentication email preparation failed: ${kind}`)
    throw new Error(AUTH_EMAIL_DELIVERY_ERROR)
  }

  const recipients = maskedRecipients(options.to)
  try {
    const { messageId, provider } = await sendEmail(options)
    console.info(
      `Authentication email sent: ${kind} to ${recipients} via ${provider}${
        messageId ? ` (${messageId})` : ""
      }`,
    )
  } catch (error) {
    console.error(
      `Authentication email delivery failed: ${kind} to ${recipients}:`,
      providerFailureReason(error),
    )
    throw new Error(AUTH_EMAIL_DELIVERY_ERROR)
  }
}

function maskedRecipients(to: SendEmailOptions["to"]): string {
  return (Array.isArray(to) ? to : [to]).map(maskEmailAddressForLog).join(", ")
}

function providerFailureReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown provider failure"
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
