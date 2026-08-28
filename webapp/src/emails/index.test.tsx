import process from "node:process"

import { beforeEach, describe, expect, test, vi } from "vitest"

import type { ProviderEmailInput } from "./types.ts"

const authEmailIndexTestState = vi.hoisted(() => ({
  sendProviderEmail: vi.fn<
    (input: ProviderEmailInput) => Promise<{ messageId: string }>
  >(() => Promise.resolve({ messageId: "test-message" })),
}))

vi.mock("../lib/config.server.ts", () => ({
  getConfig: () =>
    Promise.resolve({
      appBaseUrl: "https://app.example.test",
      emailFromAddress: "Example App <auth@example.test>",
      emailProvider: "resend",
    }),
}))

vi.mock("./providers/resend.ts", () => ({
  sendResendEmail: authEmailIndexTestState.sendProviderEmail,
}))

import { APP_NAME } from "../lib/constants.ts"
import {
  sendOrganizationInvitationEmail,
  sendPasswordChangedEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from "./index.ts"

describe("authentication email wrappers", () => {
  beforeEach(() => {
    authEmailIndexTestState.sendProviderEmail.mockClear()
  })

  test("preserves Better Auth verification and reset URLs verbatim", async () => {
    const verificationURL =
      "https://app.example.test/api/auth/verify-email?token=verify-secret&callbackURL=%2F"
    await runAuthEmailWithMockDelivery(() =>
      sendVerificationEmail({
        user: { email: "member@example.test" },
        url: verificationURL,
        expiresInSeconds: 45 * 60,
      })
    )

    const verificationInput = latestAuthEmailProviderInput()
    expect(verificationInput.subject).toBe(`Verify your email on ${APP_NAME}`)
    expect(verificationInput.text).toContain(verificationURL)
    expect(verificationInput.text).toContain("45 minutes")

    authEmailIndexTestState.sendProviderEmail.mockClear()
    const resetURL =
      "https://app.example.test/api/auth/reset-password/reset-secret?callbackURL=%2Fauth%2Freset-password"
    await runAuthEmailWithMockDelivery(() =>
      sendResetPasswordEmail({
        user: { email: "member@example.test" },
        url: resetURL,
        expiresInSeconds: 75 * 60,
      })
    )

    const resetInput = latestAuthEmailProviderInput()
    expect(resetInput.subject).toBe(`Reset your ${APP_NAME} password`)
    expect(resetInput.text).toContain(resetURL)
    expect(resetInput.text).toContain("75 minutes")
  })

  test("links invitations directly by their encoded Better Auth ID", async () => {
    const invitationId = "invite/id +?"
    const organizationName = `${"A".repeat(119)}😀 trailing text`
    const expectedInvitationURL = new URL(
      "/auth/accept-invitation",
      "https://app.example.test",
    )
    expectedInvitationURL.searchParams.set("invitationId", invitationId)

    await runAuthEmailWithMockDelivery(() =>
      sendOrganizationInvitationEmail({
        expiresInSeconds: 72 * 60 * 60,
        id: invitationId,
        email: "new-member@example.test",
        role: "owner,developer,owner",
        organization: {
          name: organizationName,
          logo: "https://tracking.example.test/organization-logo.png",
        },
        inviter: {
          user: { name: "Alex Morgan", email: "owner@example.test" },
        },
      })
    )

    const invitationInput = latestAuthEmailProviderInput()
    expect(invitationInput.to).toEqual(["new-member@example.test"])
    expect(invitationInput.text).toContain(expectedInvitationURL.toString())
    expect(invitationInput.text).toContain("Alex Morgan")
    expect(invitationInput.text).toContain("owner@example.test")
    expect(invitationInput.text).toContain("Alex Morgan (owner@example.test)")
    expect(invitationInput.text).toContain("with owner and developer access")
    expect(invitationInput.text).toContain("72 hours")
    expect(invitationInput.html).not.toContain("tracking.example.test")
    expect(invitationInput.subject).toContain("😀")
    expect(invitationInput.subject).not.toContain("�")
  })

  test("renders password-change security details", async () => {
    await runAuthEmailWithMockDelivery(() =>
      sendPasswordChangedEmail({
        user: { email: "member@example.test" },
        changedAt: new Date("2026-08-27T10:00:00.000Z"),
      })
    )

    const passwordChangedInput = latestAuthEmailProviderInput()
    expect(passwordChangedInput.subject).toBe(`Your ${APP_NAME} password was changed`)
    expect(passwordChangedInput.text).toContain("Aug 27, 2026")
    expect(passwordChangedInput.text).toContain("10:00:00 AM UTC")
    expect(passwordChangedInput.text).toContain("https://app.example.test/auth/forgot-password")
    expect(passwordChangedInput.text).toContain("use the button above to reset your password")
    expect(passwordChangedInput.text).not.toContain("contact support")
    expect(passwordChangedInput.text).not.toContain("/settings/security")
  })
})

async function runAuthEmailWithMockDelivery(action: () => Promise<void>): Promise<void> {
  const originalNodeEnv = process.env.NODE_ENV
  const originalVitest = process.env.VITEST
  // The provider and config modules are hoisted mocks; development keeps React's runtime aligned
  // with Vitest while this suite alone exercises the otherwise test-disabled delivery boundary.
  process.env.NODE_ENV = "development"
  process.env.VITEST = "false"

  try {
    await action()
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalVitest === undefined) delete process.env.VITEST
    else process.env.VITEST = originalVitest
  }
}

function latestAuthEmailProviderInput(): ProviderEmailInput {
  const call = authEmailIndexTestState.sendProviderEmail.mock.calls.at(-1)
  if (!call) throw new Error("Expected the mocked email provider to receive a message")
  return call[0] as ProviderEmailInput
}
