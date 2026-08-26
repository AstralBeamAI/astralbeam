import { afterEach, describe, expect, test, vi } from "vitest"

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

afterEach(() => {
  emailDeliveryTestState.request = null
})

describe("authentication email delivery boundary", () => {
  test("a failed send fails the response instead of passing silently", async () => {
    useRequestContext()
    await expect(deliverBlockingAuthEmail(() => Promise.reject(new Error("provider down"))))
      .rejects.toThrow("provider down")

    expect(() => assertAuthEmailDelivered()).toThrow()
  })

  test("a delivered send leaves the response untouched", async () => {
    useRequestContext()
    await deliverBlockingAuthEmail(() => Promise.resolve())

    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })

  test("a failure is scoped to the request that saw it", async () => {
    useRequestContext()
    await expect(deliverBlockingAuthEmail(() => Promise.reject(new Error("provider down"))))
      .rejects.toThrow("provider down")

    useRequestContext()
    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })

  test("the surfaced error never repeats the provider's reason", async () => {
    useRequestContext()
    await expect(deliverBlockingAuthEmail(() => Promise.reject(new Error("smtp-secret-detail"))))
      .rejects.toThrow("smtp-secret-detail")

    expect(() => assertAuthEmailDelivered()).toThrow(/could not send the email/i)
    expect(() => assertAuthEmailDelivered()).not.toThrow()
  })
})
