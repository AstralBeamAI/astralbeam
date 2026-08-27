import { describe, expect, test } from "vitest"

import { isSameOriginConfigureRequest } from "./configure-request.server"

describe("operator request boundary", () => {
  test("accepts safe methods and only same-origin browser mutations", () => {
    const publicUrl = new URL("https://app.example/configure")
    expect(isSameOriginConfigureRequest(
      new Request("https://app.example/configure"),
      publicUrl,
    )).toBe(true)
    expect(isSameOriginConfigureRequest(
      new Request("http://internal:3000/_server", {
        method: "POST",
        headers: {
          origin: "https://app.example",
          "sec-fetch-site": "same-origin",
        },
      }),
      publicUrl,
    )).toBe(true)
    expect(isSameOriginConfigureRequest(
      new Request("https://app.example/_server", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      }),
      publicUrl,
    )).toBe(false)
    expect(isSameOriginConfigureRequest(
      new Request("https://app.example/_server", {
        method: "POST",
      }),
      publicUrl,
    )).toBe(false)
  })
})
