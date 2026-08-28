import { createElement } from "react"
import { describe, expect, test } from "vitest"

import { APP_NAME } from "../lib/constants.ts"
import { emailTheme, resolveEmailRadius } from "./email-theme.ts"
import { renderEmailElement } from "./render.ts"
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

const EMAIL_TEMPLATE_TEST_ORIGIN = "https://preview.example.test"
const emailVerificationPreviewProps = createEmailVerificationPreviewProps(
  EMAIL_TEMPLATE_TEST_ORIGIN,
)
const organizationInvitationPreviewProps = createOrganizationInvitationPreviewProps(
  EMAIL_TEMPLATE_TEST_ORIGIN,
)
const passwordChangedPreviewProps = createPasswordChangedPreviewProps(EMAIL_TEMPLATE_TEST_ORIGIN)
const resetPasswordPreviewProps = createResetPasswordPreviewProps(EMAIL_TEMPLATE_TEST_ORIGIN)

const authenticationEmailRenderCases = [
  {
    actionURL: emailVerificationPreviewProps.verificationUrl,
    createElement: () => createElement(EmailVerificationEmail, emailVerificationPreviewProps),
    name: "email verification",
  },
  {
    actionURL: organizationInvitationPreviewProps.url,
    createElement: () =>
      createElement(OrganizationInvitationEmail, organizationInvitationPreviewProps),
    name: "organization invitation",
  },
  {
    actionURL: passwordChangedPreviewProps.recoverAccountURL,
    createElement: () => createElement(PasswordChangedEmail, passwordChangedPreviewProps),
    name: "password changed",
  },
  {
    actionURL: resetPasswordPreviewProps.url,
    createElement: () => createElement(ResetPasswordEmail, resetPasswordPreviewProps),
    name: "reset password",
  },
] as const

const emailTextColorPairings = [
  ["body text", emailTheme.colors.foreground, emailTheme.colors.background],
  ["card text", emailTheme.colors.foreground, emailTheme.colors.card],
  ["muted card text", emailTheme.colors.mutedForeground, emailTheme.colors.card],
  ["link text", emailTheme.colors.primary, emailTheme.colors.card],
  ["button text", emailTheme.colors.primaryForeground, emailTheme.colors.primary],
  ["muted panel text", emailTheme.colors.foreground, emailTheme.colors.muted],
] as const

describe.each(authenticationEmailRenderCases)("$name email", (emailCase) => {
  test("renders compatible static HTML and plain text from explicit props", async () => {
    const { html, text } = await renderEmailElement(emailCase.createElement())

    expect(html).toContain("<!DOCTYPE html")
    expect(text).toContain(emailCase.actionURL)
    expect(html).toContain("Or copy and paste this URL into your browser:")
    expect(html).toContain("box-sizing:border-box")
    expect(html).toContain(emailHexToInlineRgb(emailTheme.colors.background))
    expect(html).toContain(`border-top-color:${emailHexToInlineRgb(emailTheme.colors.border)}`)
    expect(html).toContain(emailHexToInlineRgb(emailTheme.colors.foreground))
    expect(html).toContain(emailHexToInlineRgb(emailTheme.colors.primary))
    expect(html).toMatch(/href="mailto:[^"]+" style="[^"]*word-break:break-all/)
    const previewMarker = 'data-skip-in-text="true"'
    const logoMarker = `alt="${APP_NAME} logo"`
    expect(html).toContain(previewMarker)
    expect(html).toContain(logoMarker)
    expect(html.indexOf(previewMarker)).toBeLessThan(html.indexOf(logoMarker))

    expect(html).not.toMatch(/<script\b|\son[a-z]+\s*=/i)
    expect(html).not.toMatch(/@media|display:\s*(?:flex|grid)/i)
    expect(html).not.toMatch(/\b\d+(?:\.\d+)?(?:rem|em)\b/i)
    expect(html).not.toMatch(/<link[^>]+(?:font|stylesheet)/i)
    expect(html).not.toMatch(/href=["']#["']/i)
    expect(html).not.toMatch(/\b(?:bg-background|text-foreground|bg-primary|max-w-container)\b/)
    expect(html).not.toMatch(/picsum|unsplash|icons8|emailcn\.run|better-auth-ui\.com|>Acme</i)
  })
})

test("limits inbox preview text to 90 characters", async () => {
  const { html } = await renderEmailElement(
    createElement(EmailVerificationEmail, {
      ...emailVerificationPreviewProps,
      appName: "A".repeat(120),
    }),
  )
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1]

  expect(title).toHaveLength(90)
  expect(title).toMatch(/…$/)
})

test("does not split emoji when limiting inbox preview text", async () => {
  const { html } = await renderEmailElement(
    createElement(EmailVerificationEmail, {
      ...emailVerificationPreviewProps,
      appName: `${"A".repeat(67)}😀${"B".repeat(80)}`,
    }),
  )
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1]

  expect(title).toContain("😀")
  expect(title).not.toContain("�")
  expect(title).toMatch(/…$/)
})

test("wraps unbounded organization and inviter names", async () => {
  const { html } = await renderEmailElement(
    createElement(OrganizationInvitationEmail, {
      ...organizationInvitationPreviewProps,
      inviterName: "I".repeat(120),
      organizationName: "O".repeat(120),
    }),
  )

  expect(html.match(/overflow-wrap:break-word/g)?.length).toBeGreaterThanOrEqual(2)
})

test.each(emailTextColorPairings)(
  "provides WCAG AA contrast for %s",
  (_name, foreground, background) => {
    expect(emailContrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
  },
)

test("preserves percentage radii allowed by the shared brand schema", () => {
  expect(resolveEmailRadius("50%")).toBe("50%")
})

function emailHexToInlineRgb(hex: string): string {
  const value = hex.slice(1)
  const channels = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((channel) =>
    Number.parseInt(channel, 16)
  )
  return `rgb(${channels.join(",")})`
}

function emailContrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = emailRelativeLuminance(foreground)
  const backgroundLuminance = emailRelativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function emailRelativeLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}
