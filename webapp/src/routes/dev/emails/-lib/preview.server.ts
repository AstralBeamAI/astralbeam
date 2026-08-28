import "@tanstack/react-start/server-only"

import { createElement } from "react"
import type { ReactElement } from "react"

import createEmailVerificationPreviewProps from "@/emails/previews/email-verification.ts"
import createOrganizationInvitationPreviewProps from "@/emails/previews/organization-invitation.ts"
import createPasswordChangedPreviewProps from "@/emails/previews/password-changed.ts"
import createResetPasswordPreviewProps from "@/emails/previews/reset-password.ts"
import { renderEmailElement } from "@/emails/render.ts"
import EmailVerificationEmail from "@/emails/templates/email-verification.tsx"
import OrganizationInvitationEmail from "@/emails/templates/organization-invitation.tsx"
import PasswordChangedEmail from "@/emails/templates/password-changed.tsx"
import ResetPasswordEmail from "@/emails/templates/reset-password.tsx"
import {
  developmentRouteResponseHeaders,
  escapeDevelopmentRouteHtml,
  handleDevelopmentRouteRequest,
  renderDevelopmentRouteDocument,
} from "../../-lib/http.server.ts"

interface EmailPreviewDefinition {
  createElement: (origin: string) => ReactElement
  description: string
  label: string
}

const EMAIL_PREVIEW_DEFINITIONS = {
  "email-verification": {
    createElement: (origin) =>
      createElement(EmailVerificationEmail, createEmailVerificationPreviewProps(origin)),
    description: "Sent after credential signup or when a user requests verification again.",
    label: "Email verification",
  },
  "organization-invitation": {
    createElement: (origin) =>
      createElement(
        OrganizationInvitationEmail,
        createOrganizationInvitationPreviewProps(origin),
      ),
    description: "Invites a recipient to join an organization with a specific role.",
    label: "Organization invitation",
  },
  "password-changed": {
    createElement: (origin) =>
      createElement(PasswordChangedEmail, createPasswordChangedPreviewProps(origin)),
    description: "Confirms a completed password change and provides a recovery path.",
    label: "Password changed",
  },
  "reset-password": {
    createElement: (origin) =>
      createElement(ResetPasswordEmail, createResetPasswordPreviewProps(origin)),
    description: "Provides a time-limited password reset link.",
    label: "Reset password",
  },
} as const satisfies Record<string, EmailPreviewDefinition>

type EmailPreviewName = keyof typeof EMAIL_PREVIEW_DEFINITIONS

export const EMAIL_PREVIEW_NAMES = Object.keys(EMAIL_PREVIEW_DEFINITIONS)
  .toSorted() as EmailPreviewName[]

function isEmailPreviewName(name: string): name is EmailPreviewName {
  return Object.hasOwn(EMAIL_PREVIEW_DEFINITIONS, name)
}

function renderEmailPreviewIndexHtml(): string {
  const templateItems = EMAIL_PREVIEW_NAMES.map((name) => {
    const definition = EMAIL_PREVIEW_DEFINITIONS[name]
    const encodedName = encodeURIComponent(name)
    return `<li class="tool">
      <a href="/dev/emails/${encodedName}"><strong>${
      escapeDevelopmentRouteHtml(definition.label)
    }</strong></a>
      <p>${escapeDevelopmentRouteHtml(definition.description)}</p>
      <div class="actions"><a class="secondary" href="/dev/emails/${encodedName}?text=1">Plain text</a></div>
    </li>`
  }).join("")

  return renderDevelopmentRouteDocument({
    bodyHtml: `<ul class="tools">${templateItems}</ul>`,
    description:
      "Development only. Production email components rendered with fixed, synthetic fixture props; no email is sent.",
    heading: "Email previews",
    navigationHtml: '<nav><a href="/dev">Development tools</a></nav>',
    title: "Email previews",
  })
}

async function emailPreviewGetResponse(request: Request, name?: string): Promise<Response> {
  const url = new URL(request.url)

  if (name === undefined) {
    return new Response(renderEmailPreviewIndexHtml(), {
      headers: developmentRouteResponseHeaders("text/html; charset=utf-8"),
    })
  }

  if (!isEmailPreviewName(name)) {
    return new Response("Unknown email preview", {
      status: 404,
      headers: developmentRouteResponseHeaders("text/plain; charset=utf-8"),
    })
  }

  try {
    const content = await renderEmailElement(
      EMAIL_PREVIEW_DEFINITIONS[name].createElement(url.origin),
    )
    const plainText = url.searchParams.get("text") === "1"
    return new Response(plainText ? content.text : content.html, {
      headers: developmentRouteResponseHeaders(
        plainText ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      ),
    })
  } catch (error) {
    console.error(`Failed to render email preview '${name}'`, error)
    return new Response("Failed to render email preview", {
      status: 500,
      headers: developmentRouteResponseHeaders("text/plain; charset=utf-8"),
    })
  }
}

export function handleEmailPreviewRequest(request: Request, name?: string): Promise<Response> {
  return handleDevelopmentRouteRequest(request, () => emailPreviewGetResponse(request, name))
}
