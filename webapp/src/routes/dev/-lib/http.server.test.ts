import { describe, expect, test } from "vitest"

import { handleDevelopmentRouteNotFoundRequest } from "./http.server.ts"

const UNKNOWN_DEVELOPMENT_ROUTE_URL = "http://preview.example.test/dev/unknown"

describe("development utility not-found response", () => {
  test.each(["GET", "POST", "OPTIONS"])("answers %s without falling through", async (method) => {
    const response = await handleDevelopmentRouteNotFoundRequest(
      new Request(UNKNOWN_DEVELOPMENT_ROUTE_URL, { method }),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'")
    expect(await response.text()).toBe("Not Found")
  })

  test("answers HEAD with not-found metadata and no body", async () => {
    const response = await handleDevelopmentRouteNotFoundRequest(
      new Request(UNKNOWN_DEVELOPMENT_ROUTE_URL, { method: "HEAD" }),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get("content-length")).toBe("9")
    expect(await response.text()).toBe("")
  })
})
