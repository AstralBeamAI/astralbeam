import { beforeEach, describe, expect, test, vi } from "vitest"

import { APP_HANDLE } from "@/lib/constants"

import { applyResponseSecurityHeaders } from "./response-headers.server"

const cacheHeaderEnvironment = vi.hoisted(() => ({ development: false }))
vi.mock(import("./environment.server"), async (importOriginal) => ({
  ...(await importOriginal()),
  get IS_DEVELOPMENT_SERVER() {
    return cacheHeaderEnvironment.development
  },
}))

beforeEach(() => {
  cacheHeaderEnvironment.development = false
})

function securityHeaders(url: string, pathname: string, requestHeaders: HeadersInit = {}): Headers {
  const headers = new Headers()
  applyResponseSecurityHeaders(
    headers,
    new Request(url, { headers: requestHeaders }),
    pathname,
    200,
  )
  return headers
}

describe("response security headers", () => {
  test.each([
    [`/${APP_HANDLE}-logo-dark.svg`, "GET", 200, false],
    ["/api/openapi.json", "HEAD", 304, false],
    [`/${APP_HANDLE}-logo-dark.svg`, "GET", 200, true],
    ["/api/openapi.json", "HEAD", 304, true],
  ])(
    "sets cache freshness for %s %s %i (development=%s)",
    (pathname, method, status, development) => {
      cacheHeaderEnvironment.development = development
      const headers = new Headers()
      applyResponseSecurityHeaders(
        headers,
        new Request(`https://app.example${pathname}`, { method }),
        pathname,
        status,
      )
      expect(headers.get("cache-control")).toBe(
        development ? "no-cache" : "public, max-age=300, must-revalidate",
      )
    },
  )

  test.each([
    ["private, no-store", "GET", 200],
    ["no-store", "GET", 200],
    ["private, no-cache", "GET", 200],
    [null, "GET", 404],
    [null, "GET", 500],
    [null, "POST", 200],
  ])("preserves cache policy %s for %s %i", (policy, method, status) => {
    const headers = new Headers(policy ? { "Cache-Control": policy } : undefined)
    applyResponseSecurityHeaders(
      headers,
      new Request("https://app.example/api/openapi.json", { method }),
      "/api/openapi.json",
      status,
    )
    expect(headers.get("cache-control")).toBe(policy)
  })

  test("preserves private cache policy for personalized docs responses", () => {
    const headers = new Headers({ "Cache-Control": "private, no-store", Vary: "Cookie" })
    applyResponseSecurityHeaders(
      headers,
      new Request("https://app.example/docs/sdk"),
      "/docs/sdk",
      200,
    )
    expect(headers.get("cache-control")).toBe("private, no-store")
    expect(headers.get("vary")).toBe("Cookie, Accept-Encoding")
  })

  test.each(["/organization", "/api/v1/tenants", "/api/v1/chat", "/api/chat"])(
    "frames and referrers are restricted on %s",
    (pathname) => {
      const headers = securityHeaders(`https://app.example${pathname}`, pathname)
      expect(headers.get("x-frame-options")).toBe("DENY")
      expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
      expect(headers.get("x-content-type-options")).toBe("nosniff")
      expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    },
  )

  test("preserves route-provided CSP without allowing framing", () => {
    const pathname = "/api/v1/chat/files"
    const headers = new Headers({ "Content-Security-Policy": "sandbox; default-src 'none'" })
    applyResponseSecurityHeaders(
      headers,
      new Request(`https://app.example${pathname}`),
      pathname,
      200,
    )
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none', frame-ancestors 'none'",
    )
    expect(headers.get("x-content-type-options")).toBe("nosniff")
  })

  test("HSTS is sent only for requests that arrived over TLS", () => {
    expect(securityHeaders("https://app.example/", "/").get("strict-transport-security")).toContain(
      "includeSubDomains",
    )
    expect(
      securityHeaders("http://app.example/", "/", { "x-forwarded-proto": "https" }).get(
        "strict-transport-security",
      ),
    ).toContain("includeSubDomains")
    expect(
      securityHeaders("http://localhost:4500/", "/").get("strict-transport-security"),
    ).toBeNull()
  })
})
