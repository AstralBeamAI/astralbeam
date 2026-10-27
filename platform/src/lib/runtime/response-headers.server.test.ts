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
    [`/${APP_HANDLE}-logo-dark.svg`, "HEAD", 304, false],
    ["/api/openapi.json", "GET", 200, false],
    ["/api/openapi.json", "GET", 200, true],
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

  test("does not cache failed requests or mutations", () => {
    for (const [method, status] of [
      ["GET", 404],
      ["POST", 200],
    ] as const) {
      const headers = new Headers()
      applyResponseSecurityHeaders(
        headers,
        new Request("https://app.example/api/openapi.json", { method }),
        "/api/openapi.json",
        status,
      )
      expect(headers.get("cache-control")).toBeNull()
    }
  })

  test("preserves private cache policy and existing Vary headers", () => {
    for (const pathname of ["/api/openapi.json", "/docs/sdk"]) {
      const headers = new Headers({ "Cache-Control": "private, no-store", Vary: "Cookie" })
      applyResponseSecurityHeaders(
        headers,
        new Request(`https://app.example${pathname}`),
        pathname,
        200,
      )
      expect(headers.get("cache-control")).toBe("private, no-store")
      expect(headers.get("vary")).toBe("Cookie, Accept-Encoding")
    }
  })

  test.each([
    ["/organization", undefined, "frame-ancestors 'none'"],
    [
      "/api/v1/chat/files",
      "sandbox; default-src 'none'",
      "sandbox; default-src 'none', frame-ancestors 'none'",
    ],
  ])("protects %s while preserving its route CSP", (pathname, csp, expected) => {
    const headers = new Headers(csp ? { "Content-Security-Policy": csp } : undefined)
    applyResponseSecurityHeaders(
      headers,
      new Request(`https://app.example${pathname}`),
      pathname,
      200,
    )
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("content-security-policy")).toBe(expected)
    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
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
