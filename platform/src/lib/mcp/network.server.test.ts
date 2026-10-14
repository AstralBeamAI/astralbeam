import { mcpHeadersAreAllowed } from "./schemas.ts"
import { describe, expect, test, vi } from "vitest"
const mcpDns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("node:dns/promises", () => mcpDns)
import {
  mcpAddressIsPublic,
  mcpBoundedResponse,
  mcpUrlIsPublic,
  mcpCreateDispatcher,
  mcpGuardedFetch,
} from "./network.server.ts"

describe("MCP outbound boundary", () => {
  test("refuses special and reserved addresses beyond the shared private-address policy", () => {
    for (const address of [
      "192.88.99.1",
      "198.18.1.1",
      "224.1.1.1",
      "64:ff9b::7f00:1",
      "2001:db8::1",
      "2d00::1",
      "2e00::1",
      "ff02::1",
      "4000::1",
    ])
      expect(mcpAddressIsPublic(address)).toBe(false)
  })
  test("refuses insecure endpoints, embedded credentials and loopback aliases", () => {
    for (const url of [
      "http://example.com",
      "https://u:p@example.com",
      "https://example.com/#token",
      "https://localhost",
      "https://2130706433",
      "https://[::1]",
    ])
      expect(mcpUrlIsPublic(new URL(url))).toBe(false)
  })
  test("the socket boundary rechecks DNS and refuses private or mixed answers for OAuth endpoints", async () => {
    mcpDns.lookup.mockReset()
    const dispatcher = mcpCreateDispatcher()
    try {
      for (const addresses of [
        [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        [{ address: "127.0.0.1", family: 4 }],
      ]) {
        mcpDns.lookup.mockResolvedValueOnce(addresses)
        await expect(
          mcpGuardedFetch(dispatcher, "https://authorization.example/token", {
            method: "POST",
            body: "grant_type=refresh_token",
            signal: AbortSignal.timeout(2000),
          }),
        ).rejects.toThrow()
      }
      expect(mcpDns.lookup).toHaveBeenCalledTimes(2)
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
    const bounded = mcpBoundedResponse(response, 10)
    await expect(bounded.text()).rejects.toThrow("size limit")
    expect(cancel).toHaveBeenCalledOnce()
  })
})
