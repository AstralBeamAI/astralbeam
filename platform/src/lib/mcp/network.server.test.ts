import { describe, expect, test, vi } from "vitest"
const mcpDns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("node:dns/promises", () => mcpDns)
import {
  mcpAddressIsPublic,
  mcpBoundedResponse,
  mcpHeadersAreAllowed,
  mcpPublicAddresses,
  mcpUrlIsPublic,
  mcpCreateDispatcher,
  mcpGuardedFetch,
} from "./network.server.ts"

describe("MCP outbound boundary", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "100.64.1.1",
    "169.254.169.254",
    "192.168.1.1",
    "192.88.99.1",
    "198.18.1.1",
    "224.1.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "4000::1",
  ])("refuses reserved address %s", (address) => expect(mcpAddressIsPublic(address)).toBe(false))
  test("pins only wholly public DNS answers and resolves anew at each new connection", async () => {
    mcpDns.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])
    await expect(mcpPublicAddresses("server.example")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 },
    ])
    await expect(mcpPublicAddresses("server.example")).rejects.toThrow("public addresses")
    expect(mcpAddressIsPublic("2001:4860:4860::8888")).toBe(true)
  })
  test.each([
    "http://example.com",
    "https://u:p@example.com",
    "https://example.com/#token",
    "https://localhost",
    "https://2130706433",
    "https://[::1]",
  ])("refuses endpoint %s", (url) => expect(mcpUrlIsPublic(new URL(url))).toBe(false))
  test("the actual dispatcher refuses private DNS at the socket boundary for OAuth endpoints", async () => {
    mcpDns.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    const dispatcher = mcpCreateDispatcher()
    try {
      await expect(
        mcpGuardedFetch(dispatcher, "https://authorization.example/token", {
          method: "POST",
          body: "grant_type=refresh_token",
          signal: AbortSignal.timeout(2000),
        }),
      ).rejects.toThrow()
      expect(mcpDns.lookup).toHaveBeenCalledWith("authorization.example", { all: true })
    } finally {
      await dispatcher.close()
    }
  })
  test("rejects request-control headers, duplicate casing and injection while allowing static bearer auth", () => {
    for (const name of [
      "Host",
      "Cookie",
      "Proxy-Authorization",
      "Mcp-Protocol-Version",
      "Mcp-Method",
      "Sec-Fetch-Site",
      "x-forwarded-host",
      "Content-Length",
    ])
      expect(mcpHeadersAreAllowed({ [name]: "secret" })).toBe(false)
    expect(mcpHeadersAreAllowed({ Authorization: "Bearer key", "X-API-Key": "key" })).toBe(true)
    expect(mcpHeadersAreAllowed({ "X-Key": "key", "x-key": "other" })).toBe(false)
    expect(mcpHeadersAreAllowed({ "X-Key": "key\r\nCookie: leaked" })).toBe(false)
  })
  test("bounds streaming responses even without a content length and cancels oversized bodies", async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8))
          controller.enqueue(new Uint8Array(8))
        },
        cancel,
      }),
    )
    const bounded = await mcpBoundedResponse(response, 10)
    await expect(bounded.text()).rejects.toThrow("size limit")
    expect(cancel).toHaveBeenCalledOnce()
    await expect(
      mcpBoundedResponse(new Response("oversized", { headers: { "Content-Length": "100" } }), 10),
    ).rejects.toThrow("size limit")
  })
})
