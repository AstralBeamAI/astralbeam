import { readdir } from "node:fs/promises"

import { describe, expect, test } from "vitest"

import { APP_LOGO_LIGHT_PNG_URL, INERT_REDIRECT_ORIGIN } from "@/lib/constants.ts"

import { EMAIL_PREVIEW_NAMES, handleEmailPreviewRequest } from "./preview.server.ts"

const EMAIL_PREVIEW_TEST_ORIGIN = "http://preview.example.test"

describe("email preview utility", () => {
  test("lists every template and its plain-text alternative", async () => {
    const response = await requestEmailPreview()
    const html = await response.text()

    expect(response.status).toBe(200)
    for (const name of EMAIL_PREVIEW_NAMES) {
      expect(html).toContain(`href="/dev/emails/${name}"`)
      expect(html).toContain(`href="/dev/emails/${name}?text=1"`)
    }
  })

  test("registers every production template and typed fixture", async () => {
    const [templateEntries, fixtureEntries] = await Promise.all([
      readdir(new URL("../../../../emails/templates/", import.meta.url)),
      readdir(new URL("../../../../emails/previews/", import.meta.url)),
    ])
    const templateNames = templateEntries
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => name.slice(0, -".tsx".length))
      .toSorted()
    const fixtureNames = fixtureEntries
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -".ts".length))
      .toSorted()

    expect(EMAIL_PREVIEW_NAMES).toEqual(templateNames)
    expect(EMAIL_PREVIEW_NAMES).toEqual(fixtureNames)
  })

  test("renders production HTML with same-origin synthetic fixture URLs", async () => {
    const response = await requestEmailPreview("email-verification")
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(html).toContain("Verify your email")
    expect(html).toContain(`${EMAIL_PREVIEW_TEST_ORIGIN}${APP_LOGO_LIGHT_PNG_URL}`)
    expect(html).toContain(`${INERT_REDIRECT_ORIGIN}/api/auth/verify-email`)
    expect(html).not.toContain(":3002/assets/")
    expect(html.match(/<!DOCTYPE html/g)).toHaveLength(1)
    expect(html.match(/<html/g)).toHaveLength(1)
    expect(html.match(/<head/g)).toHaveLength(1)
    expect(html.match(/<body/g)).toHaveLength(1)
    expect(html).not.toContain("Development tools")
    expect(html).not.toMatch(/<script\b/i)
  })

  test("renders plain text only for the explicit text option", async () => {
    const textResponse = await requestEmailPreview("email-verification", "?text=1")
    expect(textResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(await textResponse.text()).toContain("VERIFY YOUR EMAIL")

    const htmlResponse = await requestEmailPreview("email-verification", "?text=0")
    expect(htmlResponse.headers.get("content-type")).toBe("text/html; charset=utf-8")
  })

  test("rejects unknown templates and unsupported methods", async () => {
    const unknownResponse = await requestEmailPreview("__proto__")
    expect(unknownResponse.status).toBe(404)
    expect(await unknownResponse.text()).toBe("Unknown email preview")

    const postResponse = await requestEmailPreview("email-verification", "", { method: "POST" })
    expect(postResponse.status).toBe(405)
    expect(postResponse.headers.get("allow")).toBe("GET, HEAD")
  })

  test("answers HEAD with GET metadata and no response body", async () => {
    const getResponse = await requestEmailPreview("email-verification")
    const getContentLength = (await getResponse.arrayBuffer()).byteLength
    const headResponse = await requestEmailPreview("email-verification", "", { method: "HEAD" })

    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get("content-length")).toBe(String(getContentLength))
    expect(await headResponse.text()).toBe("")
  })
})

function requestEmailPreview(
  name?: string,
  search = "",
  init?: RequestInit,
): Promise<Response> {
  const path = name === undefined ? "/dev/emails" : `/dev/emails/${name}`
  return handleEmailPreviewRequest(
    new Request(`${EMAIL_PREVIEW_TEST_ORIGIN}${path}${search}`, init),
    name,
  )
}
