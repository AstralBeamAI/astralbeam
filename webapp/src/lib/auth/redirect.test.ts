import { describe, expect, test } from "vitest"

import {
  normalizeReturnPath,
  normalizeReturnPathFromSearch,
  resolveRedirectOrigin,
} from "./redirect.ts"

const ORIGIN = "https://app.example.com"

describe("resolveRedirectOrigin", () => {
  test.each([
    null,
    undefined,
    {},
    { origin: "" },
    { origin: "null" },
    { origin: "file://local/path" },
  ])(
    "uses the fallback outside a browser",
    (location) => {
      expect(resolveRedirectOrigin(location, ORIGIN)).toBe(ORIGIN)
    },
  )

  test("uses the browser origin when available", () => {
    expect(
      resolveRedirectOrigin({ origin: "http://localhost:3000" }, ORIGIN),
    ).toBe("http://localhost:3000")
  })
})

describe("normalizeReturnPath", () => {
  test.each([
    ["/", "/"],
    ["/settings/account?tab=profile#name", "/settings/account?tab=profile#name"],
    [`${ORIGIN}/organization/members`, "/organization/members"],
  ])("keeps a same-origin application path", (value, expected) => {
    expect(normalizeReturnPath(value, ORIGIN)).toBe(expected)
  })

  test.each([
    undefined,
    "https://attacker.example/dashboard",
    "//attacker.example/dashboard",
    "javascript:alert(1)",
    "/api/auth/session",
    "/auth/sign-in",
    "/%61uth/sign-up",
    "/bad%path",
  ])("falls back for an unsafe or reserved target", (value) => {
    expect(normalizeReturnPath(value, ORIGIN)).toBe("/")
  })

  test("permits only an explicitly allowed auth task path", () => {
    expect(
      normalizeReturnPath(
        "/auth/accept-invitation?invitationId=invitation-a",
        ORIGIN,
        ["/auth/accept-invitation"],
      ),
    ).toBe("/auth/accept-invitation?invitationId=invitation-a")
    expect(
      normalizeReturnPath("/auth/sign-in", ORIGIN, ["/auth/accept-invitation"]),
    ).toBe("/")
  })

  test("preserves an invitation target from an OAuth signup-disabled callback", () => {
    expect(
      normalizeReturnPathFromSearch(
        "?error=signup_disabled&redirectTo=%2Fauth%2Faccept-invitation%3FinvitationId%3Dinvitation-a",
        ORIGIN,
        ["/auth/accept-invitation"],
      ),
    ).toBe("/auth/accept-invitation?invitationId=invitation-a")
  })
})
