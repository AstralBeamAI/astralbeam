import { describe, expect, it } from "vitest"

import { normalizeAuthRedirect } from "./auth-redirect"

describe("normalizeAuthRedirect", () => {
  it("preserves an internal path, search, and hash", () => {
    expect(normalizeAuthRedirect("/settings/security?tab=sessions#current")).toBe(
      "/settings/security?tab=sessions#current",
    )
  })

  it.each([
    "https://example.com/phishing",
    "//example.com/phishing",
    "/..//example.com/phishing",
    "/%2e%2e//example.com/phishing",
    "/\\example.com/phishing",
  ])("rejects a redirect that can resolve outside the app: %s", (value) => {
    expect(normalizeAuthRedirect(value)).toBeUndefined()
  })
})
