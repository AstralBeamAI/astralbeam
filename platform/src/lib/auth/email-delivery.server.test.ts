import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createAuthMiddleware } from "better-auth/api"
import { Effect } from "effect"
import { describe, expect, test } from "vitest"

import {
  AUTH_EMAIL_DELIVERY_FAILED_CODE,
  AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
} from "@/lib/auth/email-delivery"
import {
  assertAuthEmailDelivered,
  deliverBlockingAuthEmail,
  runWithAuthEmailDeliveryScope,
  withBlockingAuthEmailDelivery,
} from "@/lib/auth/email-delivery.server"
import { EmailDeliveryError } from "@/lib/email/errors"

function deliveryFailure(reason: string): Promise<void> {
  return deliverBlockingAuthEmail(Effect.fail(new EmailDeliveryError({ reason })))
}

describe("authentication email delivery boundary", () => {
  test("first and duplicate signup report a safe delivery failure over HTTP", async () => {
    const send = () => deliveryFailure("smtp-secret-detail")
    const auth = betterAuth({
      baseURL: "https://example.com",
      secret: "auth-email-delivery-fixture-secret",
      database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
      logger: { disabled: true },
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        onExistingUserSignUp: send,
      },
      emailVerification: { sendOnSignUp: true, sendVerificationEmail: send },
      hooks: {
        after: createAuthMiddleware(() => {
          assertAuthEmailDelivered()
          return Promise.resolve()
        }),
      },
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = new Request("https://example.com/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test user",
          email: "review@example.com",
          password: "fixture-password",
        }),
      })
      const response = await runWithAuthEmailDeliveryScope(() => auth.handler(request))
      expect(response.status).toBe(503)
      const body: unknown = await response.json()
      expect(body).toMatchObject({
        code: AUTH_EMAIL_DELIVERY_FAILED_CODE,
        message: AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
      })
      expect(JSON.stringify(body)).not.toContain("smtp-secret-detail")
    }
  })

  test("a delivered send leaves the response untouched", async () => {
    await runWithAuthEmailDeliveryScope(async () => {
      await deliverBlockingAuthEmail(Effect.void)
      expect(assertAuthEmailDelivered).not.toThrow()
    })
  })

  test("a defect, such as an unreachable configuration, fails the response the same way", async () => {
    await runWithAuthEmailDeliveryScope(async () => {
      await expect(
        deliverBlockingAuthEmail(Effect.die(new Error("database-private-detail"))),
      ).rejects.toMatchObject({ statusCode: 503, body: { code: AUTH_EMAIL_DELIVERY_FAILED_CODE } })
      expect(assertAuthEmailDelivered).toThrow(/could not send the email/i)
      runWithAuthEmailDeliveryScope(() => {
        expect(assertAuthEmailDelivered).not.toThrow()
      })
    })
  })

  test("a requestless swallowed send failure is still reported to the caller", async () => {
    await expect(
      Effect.runPromise(
        withBlockingAuthEmailDelivery(async () => {
          await deliveryFailure("provider down").catch(() => undefined)
          return "Better Auth swallowed the rejection"
        }),
      ),
    ).rejects.toMatchObject({ _tag: "AuthEmailNotDelivered" })
  })
})
