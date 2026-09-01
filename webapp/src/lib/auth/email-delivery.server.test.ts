import { afterEach, describe, expect, test, vi } from "vitest"

import { AUTH_EMAIL_DELIVERY_FAILED_CODE } from "@/lib/auth/email-delivery"

const emailDeliveryTestState = vi.hoisted(() => ({
  request: null as Request | null,
}))

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!emailDeliveryTestState.request) throw new Error("no request context")
    return emailDeliveryTestState.request
  },
}))

import {
  assertAuthEmailDelivered,
  deliverBlockingAuthEmail,
} from "@/lib/auth/email-delivery.server"

function useRequestContext(): Request {
  emailDeliveryTestState.request = new Request("https://example.com/api/auth/sign-up/email")
  return emailDeliveryTestState.request
}

function deliveryFailure(reason: string): Promise<void> {
  return deliverBlockingAuthEmail(() => Promise.reject(new Error(reason)))
}

afterEach(() => {
  emailDeliveryTestState.request = null
})

describe("authentication email delivery boundary", () => {
  test("a failed send fails the response instead of passing silently", async () => {
    useRequestContext()
    await expect(deliveryFailure("provider down")).rejects.toMatchObject({
      statusCode: 503,
      body: { code: AUTH_EMAIL_DELIVERY_FAILED_CODE },
    })

    expect(() => assertAuthEmailDelivered()).toThrow()
  })

  test("a delivered send leaves the response untouched", async () => {
    useRequestContext()
    await deliverBlockingAuthEmail(() => Promise.resolve())

    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })

  test("a failure is scoped to the request that saw it", async () => {
    useRequestContext()
    await expect(deliveryFailure("provider down")).rejects.toThrow()

    useRequestContext()
    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })

  test("neither the thrown nor the asserted error repeats the provider's reason", async () => {
    useRequestContext()
    const thrown = await deliveryFailure("smtp-secret-detail").catch((error: unknown) => error)
    expect(JSON.stringify(thrown)).not.toContain("smtp-secret-detail")

    expect(() => assertAuthEmailDelivered()).toThrow(/could not send the email/i)
    // The record is consumed, so one failure cannot fail a later response.
    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })

  test("a send outside a request context still rejects", async () => {
    await expect(deliveryFailure("provider down")).rejects.toThrow()
    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })
})
