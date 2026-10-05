import { createElement, type ReactElement } from "react"

import { truncateEmailGraphemes } from "@/emails/email-text"
import AccountExistsEmail from "@/emails/templates/account-exists"
import EmailVerificationEmail from "@/emails/templates/email-verification"
import OrganizationDeletedEmail from "@/emails/templates/organization-deleted"
import OrganizationInvitationEmail from "@/emails/templates/organization-invitation"
import PasswordChangedEmail from "@/emails/templates/password-changed"
import ResetPasswordEmail from "@/emails/templates/reset-password"
import SupportRequestEmail from "@/emails/templates/support-request"
import WelcomeEmail from "@/emails/templates/welcome"
import { APP_NAME } from "@/lib/constants"
import type { ProviderEmailAttachment } from "./providers/providers.server.ts"

/** Log label identifying which email a send outcome belongs to. */
export type EmailKind =
  | "account-exists"
  | "email-verification"
  | "organization-deleted"
  | "organization-invitation"
  | "password-changed"
  | "reset-password"
  | "support-request"
  | "welcome"

export interface EmailMessage {
  readonly to: string
  /** Copies the support address so replies start a thread with the team. */
  readonly cc?: string | undefined
  readonly subject: string
  readonly react: ReactElement
  readonly attachments?: readonly ProviderEmailAttachment[]
}

/** Templates cannot resolve relative paths, so links and logos use the configured origin. */
export interface EmailContext {
  readonly appBaseUrl: string
  readonly logoURL: string
  readonly supportEmailAddress: string | undefined
  /** When the send is prepared, for templates that report the time of the event. */
  readonly now: Date
}

export interface BetterAuthLinkEmailData {
  readonly expiresInSeconds: number
  readonly user: { readonly email: string }
  readonly url: string
}

export interface AccountExistsEmailData {
  readonly user: { readonly email: string }
}

export interface PasswordChangedEmailData {
  readonly user: { readonly email: string }
  readonly changedAt?: Date | undefined
}

export interface OrganizationInvitationEmailData {
  readonly expiresInSeconds: number
  readonly id: string
  readonly email: string
  readonly role: string
  readonly organization: { readonly name: string; readonly logo?: string | null | undefined }
  readonly inviter: { readonly user: { readonly name: string; readonly email: string } }
}

export interface OrganizationDeletedEmailData {
  readonly email: string
  readonly organizationName: string
  readonly deletedAt: Date
}

export interface WelcomeEmailData {
  readonly user: { readonly name: string; readonly email: string }
}

export interface SupportRequestEmailData {
  readonly user: { readonly name: string; readonly email: string }
  readonly message: string
  readonly pageURL?: string | undefined
  readonly attachments: readonly ProviderEmailAttachment[]
}

export function verificationEmailMessage(
  data: BetterAuthLinkEmailData,
  { logoURL }: EmailContext,
): EmailMessage {
  return {
    to: data.user.email,
    subject: `Verify your email on ${APP_NAME}`,
    react: createElement(EmailVerificationEmail, {
      appName: APP_NAME,
      verificationUrl: data.url,
      email: data.user.email,
      expiryMinutes: data.expiresInSeconds / 60,
      logoURL,
    }),
  }
}

export function resetPasswordEmailMessage(
  data: BetterAuthLinkEmailData,
  { logoURL }: EmailContext,
): EmailMessage {
  return {
    to: data.user.email,
    subject: `Reset your ${APP_NAME} password`,
    react: createElement(ResetPasswordEmail, {
      url: data.url,
      email: data.user.email,
      appName: APP_NAME,
      expirationMinutes: data.expiresInSeconds / 60,
      logoURL,
    }),
  }
}

export function passwordChangedEmailMessage(
  data: PasswordChangedEmailData,
  { appBaseUrl, logoURL, now }: EmailContext,
): EmailMessage {
  return {
    to: data.user.email,
    subject: `Your ${APP_NAME} password was changed`,
    react: createElement(PasswordChangedEmail, {
      email: data.user.email,
      timestamp: formatEmailTimestamp(data.changedAt ?? now),
      recoverAccountURL: new URL("/auth/forgot-password", appBaseUrl).toString(),
      appName: APP_NAME,
      logoURL,
    }),
  }
}

/** Tells a verified account's owner why a sign-up with their address went nowhere, since Better
 * Auth answers it with a synthetic user rather than confirm the address exists. */
export function accountExistsEmailMessage(
  data: AccountExistsEmailData,
  { appBaseUrl, logoURL }: EmailContext,
): EmailMessage {
  return {
    to: data.user.email,
    subject: `Your ${APP_NAME} account already exists`,
    react: createElement(AccountExistsEmail, {
      appName: APP_NAME,
      email: data.user.email,
      logoURL,
      recoverAccountURL: new URL("/auth/forgot-password", appBaseUrl).toString(),
      signInURL: new URL("/auth/sign-in", appBaseUrl).toString(),
    }),
  }
}

export function organizationInvitationEmailMessage(
  data: OrganizationInvitationEmailData,
  { appBaseUrl, logoURL }: EmailContext,
): EmailMessage {
  const invitationURL = new URL("/auth/accept-invitation", appBaseUrl)
  invitationURL.searchParams.set("invitationId", data.id)
  return {
    to: data.email,
    subject: `You're invited to ${sanitizeEmailSubjectPart(data.organization.name)} on ${APP_NAME}`,
    react: createElement(OrganizationInvitationEmail, {
      url: invitationURL.toString(),
      inviterName: data.inviter.user.name,
      inviterEmail: data.inviter.user.email,
      organizationName: data.organization.name,
      role: formatInvitationRoles(data.role),
      appName: APP_NAME,
      expirationHours: data.expiresInSeconds / (60 * 60),
      logoURL,
    }),
  }
}

export function organizationDeletedEmailMessage(
  data: OrganizationDeletedEmailData,
  { appBaseUrl, logoURL }: EmailContext,
): EmailMessage {
  return {
    to: data.email,
    subject: `${sanitizeEmailSubjectPart(data.organizationName)} was deleted on ${APP_NAME}`,
    react: createElement(OrganizationDeletedEmail, {
      appName: APP_NAME,
      dashboardURL: new URL("/", appBaseUrl).toString(),
      logoURL,
      organizationName: data.organizationName,
      timestamp: formatEmailTimestamp(data.deletedAt),
    }),
  }
}

export function welcomeEmailMessage(
  data: WelcomeEmailData,
  { appBaseUrl, logoURL, supportEmailAddress }: EmailContext,
): EmailMessage {
  return {
    to: data.user.email,
    cc: supportEmailAddress,
    subject: `Welcome to ${APP_NAME}`,
    react: createElement(WelcomeEmail, {
      appName: APP_NAME,
      dashboardURL: new URL("/", appBaseUrl).toString(),
      logoURL,
      name: data.user.name,
      supportEmail: supportEmailAddress,
    }),
  }
}

export function supportRequestEmailMessage(
  data: SupportRequestEmailData,
  { logoURL, supportEmailAddress }: EmailContext,
): EmailMessage {
  const firstLine = data.message.trim().split("\n")[0] ?? ""
  const summary = truncateEmailGraphemes(firstLine.replaceAll(/\s+/g, " ").trim(), 80)
  return {
    to: data.user.email,
    cc: supportEmailAddress,
    subject: `${APP_NAME} support request: ${summary}`,
    react: createElement(SupportRequestEmail, {
      appName: APP_NAME,
      attachmentNames: data.attachments.map((attachment) => attachment.filename),
      email: data.user.email,
      logoURL,
      message: data.message,
      name: data.user.name,
      pageURL: data.pageURL,
    }),
    attachments: data.attachments,
  }
}

/** A recipient for a server log: the domain stays readable to spot a domain outage, and the
 * local part becomes a fixed-width mask that leaks neither its characters nor its length. */
export function maskEmailAddressForLog(value: string): string {
  const separator = value.lastIndexOf("@")
  if (separator < 1) return "***"
  const local = value.slice(0, separator)
  const domain = value.slice(separator + 1)
  const masked = local.length >= 4 ? `${local[0]}***${local.at(-1)}` : `${local[0]}***`
  return `${masked}@${domain}`
}

function formatEmailTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(date)
}

function sanitizeEmailSubjectPart(value: string): string {
  const normalized = truncateEmailGraphemes(value.replaceAll(/\s+/g, " ").trim(), 120)
  return normalized || "your organization"
}

function formatInvitationRoles(value: string): string {
  const roles = [
    ...new Set(
      value
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ]
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    roles.length > 0 ? roles : ["member"],
  )
}
