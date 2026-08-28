import { describe, expect, test } from "vitest"

import { handleDevelopmentIndexRequest } from "./index.server.ts"

const DEVELOPMENT_INDEX_TEST_URL = "http://preview.example.test/dev"

describe("development utility index", () => {
  test("links to the registered utilities with hardened headers", async () => {
    const response = await handleDevelopmentIndexRequest(new Request(DEVELOPMENT_INDEX_TEST_URL))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'")
    expect(html).toContain('href="/dev/emails"')
    expect(html).toContain("Email previews")
  })

  test("answers HEAD with GET metadata and no body", async () => {
    const getResponse = await handleDevelopmentIndexRequest(new Request(DEVELOPMENT_INDEX_TEST_URL))
    const getContentLength = (await getResponse.arrayBuffer()).byteLength
    const headResponse = await handleDevelopmentIndexRequest(
      new Request(DEVELOPMENT_INDEX_TEST_URL, { method: "HEAD" }),
    )

    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get("content-length")).toBe(String(getContentLength))
    expect(await headResponse.text()).toBe("")
  })
})
