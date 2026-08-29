import { createElement } from "react"
import type { ReactElement } from "react"

import { renderEmailElement } from "./render.server.ts"
import EmailVerificationEmail, {
  createEmailVerificationPreviewProps,
} from "./templates/email-verification.tsx"
import OrganizationInvitationEmail, {
  createOrganizationInvitationPreviewProps,
} from "./templates/organization-invitation.tsx"
import PasswordChangedEmail, {
  createPasswordChangedPreviewProps,
} from "./templates/password-changed.tsx"
import ResetPasswordEmail, { createResetPasswordPreviewProps } from "./templates/reset-password.tsx"

const EMAIL_PREVIEWS = [
  {
    name: "email-verification",
    label: "Email verification",
    element: (origin: string) =>
      createElement(EmailVerificationEmail, createEmailVerificationPreviewProps(origin)),
  },
  {
    name: "organization-invitation",
    label: "Organization invitation",
    element: (origin: string) =>
      createElement(OrganizationInvitationEmail, createOrganizationInvitationPreviewProps(origin)),
  },
  {
    name: "password-changed",
    label: "Password changed",
    element: (origin: string) =>
      createElement(PasswordChangedEmail, createPasswordChangedPreviewProps(origin)),
  },
  {
    name: "reset-password",
    label: "Reset password",
    element: (origin: string) =>
      createElement(ResetPasswordEmail, createResetPasswordPreviewProps(origin)),
  },
] satisfies ReadonlyArray<{
  element: (origin: string) => ReactElement
  label: string
  name: string
}>

function emailPreviewIndex(): Response {
  const links = EMAIL_PREVIEWS.map(({ label, name }) =>
    `<li><a href="/dev/emails/${name}">${label}</a> · <a href="/dev/emails/${name}?text=1">Text</a></li>`
  ).join("")
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Email previews</title><h1>Email previews</h1><p><a href="/dev">Development tools</a></p><p>Synthetic props; no email is sent.</p><ul>${links}</ul>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

export async function handleEmailPreviewRequest(
  request: Request,
  name?: string,
): Promise<Response> {
  if (!name) return emailPreviewIndex()

  const preview = EMAIL_PREVIEWS.find((candidate) => candidate.name === name)
  if (!preview) return new Response("Not Found", { status: 404 })

  const url = new URL(request.url)
  const { html, text } = await renderEmailElement(preview.element(url.origin))
  const plainText = url.searchParams.get("text") === "1"
  return new Response(plainText ? text : html, {
    headers: {
      "content-type": plainText ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
    },
  })
}
