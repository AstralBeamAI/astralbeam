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
    `<li class="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <span class="font-medium">${label}</span>
      <span class="flex gap-2">
        <a class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90" href="/dev/emails/${name}">Preview</a>
        <a class="inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent" href="/dev/emails/${name}?text=1">Plain text</a>
      </span>
    </li>`
  ).join("")
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email previews</title>
  <link rel="stylesheet" href="/src/styles.css">
</head>
<body class="min-h-svh bg-background text-foreground antialiased">
  <main class="mx-auto max-w-3xl space-y-8 px-6 py-16">
    <header class="space-y-3">
      <a class="text-sm font-medium text-primary hover:underline" href="/dev">← Development tools</a>
      <h1 class="font-heading text-3xl font-semibold tracking-tight">Email previews</h1>
      <p class="text-muted-foreground">Rendered with synthetic data. Previewing does not send email.</p>
    </header>
    <ul class="grid gap-3">${links}</ul>
  </main>
</body>
</html>`,
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
