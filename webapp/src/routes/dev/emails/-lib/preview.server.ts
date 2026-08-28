import "@tanstack/react-start/server-only"

import { createElement } from "react"
import type { ReactElement } from "react"

import { renderEmailElement } from "@/emails/render.ts"
import EmailVerificationEmail, {
  createEmailVerificationPreviewProps,
} from "@/emails/templates/email-verification.tsx"
import OrganizationInvitationEmail, {
  createOrganizationInvitationPreviewProps,
} from "@/emails/templates/organization-invitation.tsx"
import PasswordChangedEmail, {
  createPasswordChangedPreviewProps,
} from "@/emails/templates/password-changed.tsx"
import ResetPasswordEmail, {
  createResetPasswordPreviewProps,
} from "@/emails/templates/reset-password.tsx"
import {
  developmentPage,
  developmentResponse,
  handleDevelopmentRequest,
} from "../../-lib/http.server.ts"

const EMAIL_PREVIEWS = {
  "email-verification": {
    label: "Email verification",
    element: (origin) =>
      createElement(EmailVerificationEmail, createEmailVerificationPreviewProps(origin)),
  },
  "organization-invitation": {
    label: "Organization invitation",
    element: (origin) =>
      createElement(
        OrganizationInvitationEmail,
        createOrganizationInvitationPreviewProps(origin),
      ),
  },
  "password-changed": {
    label: "Password changed",
    element: (origin) =>
      createElement(PasswordChangedEmail, createPasswordChangedPreviewProps(origin)),
  },
  "reset-password": {
    label: "Reset password",
    element: (origin) => createElement(ResetPasswordEmail, createResetPasswordPreviewProps(origin)),
  },
} as const satisfies Record<string, { element: (origin: string) => ReactElement; label: string }>

type EmailPreviewName = keyof typeof EMAIL_PREVIEWS

const EMAIL_PREVIEW_NAMES = Object.keys(EMAIL_PREVIEWS).toSorted() as EmailPreviewName[]

function isEmailPreviewName(name: string): name is EmailPreviewName {
  return Object.hasOwn(EMAIL_PREVIEWS, name)
}

function emailPreviewIndex(): Response {
  const links = EMAIL_PREVIEW_NAMES.map((name) =>
    `<li><a href="/dev/emails/${name}">${
      EMAIL_PREVIEWS[name].label
    }</a> · <a href="/dev/emails/${name}?text=1">Text</a></li>`
  ).join("")
  return developmentResponse(
    developmentPage(
      "Email previews",
      `<p><a href="/dev">Development tools</a></p><p>Synthetic props; no email is sent.</p><ul>${links}</ul>`,
    ),
  )
}

async function emailPreview(request: Request, name?: string): Promise<Response> {
  if (name === undefined) return emailPreviewIndex()
  if (!isEmailPreviewName(name)) {
    return developmentResponse("Not Found", "text/plain; charset=utf-8", 404)
  }

  const url = new URL(request.url)
  const { html, text } = await renderEmailElement(EMAIL_PREVIEWS[name].element(url.origin))
  const plainText = url.searchParams.get("text") === "1"
  return developmentResponse(
    plainText ? text : html,
    plainText ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
  )
}

export function handleEmailPreviewRequest(request: Request, name?: string): Promise<Response> {
  return handleDevelopmentRequest(request, () => emailPreview(request, name))
}
