import { expect, test } from "vitest"

import { APP_LOGO_LIGHT_PNG_URL, INERT_REDIRECT_ORIGIN } from "@/lib/constants.ts"

import { handleEmailPreviewRequest } from "./preview.server.ts"

const ORIGIN = "http://preview.example.test"

test("serves email previews as HTML and text", async () => {
  const htmlResponse = await request("email-verification")
  const html = await htmlResponse.text()
  expect(htmlResponse.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(html).toContain(`${ORIGIN}${APP_LOGO_LIGHT_PNG_URL}`)
  expect(html).toContain(INERT_REDIRECT_ORIGIN)

  const textResponse = await request("email-verification", "?text=1")
  expect(textResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8")

  const headResponse = await request("email-verification", "", { method: "HEAD" })
  expect(headResponse.headers.get("content-length")).toBe(
    String(new TextEncoder().encode(html).length),
  )
  expect(await headResponse.text()).toBe("")

  expect((await request("missing")).status).toBe(404)
  expect((await request("email-verification", "", { method: "POST" })).status).toBe(405)
})

function request(name?: string, search = "", init?: RequestInit): Promise<Response> {
  const path = name === undefined ? "/dev/emails" : `/dev/emails/${name}`
  return handleEmailPreviewRequest(new Request(`${ORIGIN}${path}${search}`, init), name)
}
