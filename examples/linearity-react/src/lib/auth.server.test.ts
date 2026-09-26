import { describe, expect, it } from "vitest"
import { basicAuth } from "./auth.server.ts"

describe("playground Basic Auth", () => {
  it("fails closed with missing configuration and malformed credentials", () => {
    const request = new Request("https://play.example/")
    expect(basicAuth(request, undefined, undefined)?.status).toBe(503)
    expect(basicAuth(request, "demo", "password")?.status).toBe(401)
    expect(
      basicAuth(
        new Request(request, { headers: { authorization: "Basic !!!" } }),
        "demo",
        "password",
      )?.status,
    ).toBe(401)
  })
  it("accepts only the configured credentials, including passwords containing colons", () => {
    const request = (password: string) =>
      new Request("https://play.example/", {
        headers: { authorization: `Basic ${btoa(`demo:${password}`)}` },
      })
    expect(basicAuth(request("correct:password"), "demo", "correct:password")).toBeUndefined()
    const denied = basicAuth(request("wrong"), "demo", "correct:password")
    expect(denied?.status).toBe(401)
    expect(denied?.headers.get("Cache-Control")).toBe("private, no-store")
  })
})
