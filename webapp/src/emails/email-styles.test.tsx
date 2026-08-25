import { render } from "@react-email/render"
import { createElement } from "react"
import { describe, expect, test } from "vitest"

import { APP_NAME } from "../lib/constants.ts"
import EmailVerificationEmail from "./templates/email-verification.tsx"

describe("authentication email theme", () => {
  test("inlines the light palette and preserves selectors for dark-mode overrides", async () => {
    const html = await render(createElement(EmailVerificationEmail, {
      appName: APP_NAME,
      email: "member@example.com",
      expiryMinutes: 60,
      logoURL: {
        light: "https://example.com/light.png",
        dark: "https://example.com/dark.png",
      },
      verificationUrl: "https://example.com/verify",
    }))

    expect(html).toContain("#0c7a69")
    expect(html).toContain("#35d6b0")
    expect(html).toContain("@media (prefers-color-scheme: dark)")
    expect(html).toContain('class="email-bg-background email-text-foreground"')
    expect(html).toContain("email-bg-card email-border-border email-text-card-foreground")
    expect(html).toContain("email-bg-primary email-text-primary-foreground")
  })
})
