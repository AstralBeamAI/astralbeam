import { describe, expect, test } from "vitest"

import { applyResponseSecurityHeaders } from "./response-headers.server"

function securityHeaders(url: string, pathname: string, requestHeaders: HeadersInit = {}): Headers {
  const headers = new Headers()
  applyResponseSecurityHeaders(headers, new Request(url, { headers: requestHeaders }), pathname)
  return headers
}

describe("response security headers", () => {
  test("preserves private cache policy for personalized docs responses", () => {
    const headers = new Headers({ "Cache-Control": "private, no-store" })
    applyResponseSecurityHeaders(headers, new Request("https://app.example/docs/sdk"), "/docs/sdk")
    expect(headers.get("cache-control")).toBe("private, no-store")
  })

  test("frames and referrers are restricted on application responses", () => {
    const headers = securityHeaders("https://app.example/organization", "/organization")
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
  })

  test("the cross-origin embedded chat API keeps its own framing and CSP", () => {
    for (const pathname of ["/api/chat", "/api/chat/config", "/api/chat/files"]) {
      const headers = securityHeaders(`https://app.example${pathname}`, pathname)
      expect(headers.get("x-frame-options")).toBeNull()
      expect(headers.get("content-security-policy")).toBeNull()
      expect(headers.get("x-content-type-options")).toBe("nosniff")
    }
  })

  test("HSTS is sent only for requests that arrived over TLS", () => {
    expect(securityHeaders("https://app.example/", "/").get("strict-transport-security"))
      .toContain("includeSubDomains")
    expect(
      securityHeaders("http://app.example/", "/", { "x-forwarded-proto": "https" })
        .get("strict-transport-security"),
    ).toContain("includeSubDomains")
    expect(securityHeaders("http://localhost:4500/", "/").get("strict-transport-security"))
      .toBeNull()
  })
})
