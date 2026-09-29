import { Effect } from "effect"
import { describe, expect, test } from "vitest"

import { AUTH_EMAIL_DELIVERY_FAILED_CODE } from "@/lib/auth/email-delivery"
import {
  assertAuthEmailDelivered,
  deliverBlockingAuthEmail,
} from "@/lib/auth/email-delivery.server"
import { EmailDeliveryError } from "@/lib/email/errors"

function signUpRequest(): Request {
  return new Request("https://example.com/api/auth/sign-up/email")
}

function deliveryFailure(request: Request | undefined, reason: string): Promise<void> {
  return deliverBlockingAuthEmail(request, Effect.fail(new EmailDeliveryError({ reason })))
}

describe("authentication email delivery boundary", () => {
  test("a failed send fails the response instead of passing silently", async () => {
    const request = signUpRequest()
    await expect(deliveryFailure(request, "provider down")).rejects.toMatchObject({
      statusCode: 503,
      body: { code: AUTH_EMAIL_DELIVERY_FAILED_CODE },
    })
    expect(() => assertAuthEmailDelivered(request)).toThrow()
  })

  test("a delivered send leaves the response untouched", async () => {
    const request = signUpRequest()
    await deliverBlockingAuthEmail(request, Effect.void)
    expect(() => assertAuthEmailDelivered(request)).not.toThrow()
  })

  test("a defect, such as an unreachable configuration, fails the response the same way", async () => {
    const request = signUpRequest()
    await expect(
      deliverBlockingAuthEmail(request, Effect.die(new Error("database-private-detail"))),
    ).rejects.toMatchObject({ statusCode: 503, body: { code: AUTH_EMAIL_DELIVERY_FAILED_CODE } })
    expect(() => assertAuthEmailDelivered(request)).toThrow()
  })

  test("a failure is scoped to the request that saw it", async () => {
    await expect(deliveryFailure(signUpRequest(), "provider down")).rejects.toThrow()
    expect(() => assertAuthEmailDelivered(signUpRequest())).not.toThrow()
  })

  test("neither the thrown nor the asserted error repeats the provider's reason", async () => {
    const request = signUpRequest()
    const thrown = await deliveryFailure(request, "smtp-secret-detail").catch(
      (error: unknown) => error,
    )
    expect(JSON.stringify(thrown)).not.toContain("smtp-secret-detail")
    expect(() => assertAuthEmailDelivered(request)).toThrow(/could not send the email/i)
    // The record is consumed, so one failure cannot fail a later response.
    expect(() => assertAuthEmailDelivered(request)).not.toThrow()
  })

  test("a send outside a request still rejects", async () => {
    await expect(deliveryFailure(undefined, "provider down")).rejects.toThrow()
    expect(() => assertAuthEmailDelivered(undefined)).not.toThrow()
  })
})
