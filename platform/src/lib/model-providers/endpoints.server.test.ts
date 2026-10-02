import { describe, expect, test, vi } from "vitest"

// The resolver is the boundary a rebinding or internal DNS name controls.
vi.mock("node:dns/promises", () => ({
  lookup: () => Promise.resolve([{ address: "10.0.0.5", family: 4 }]),
}))

import {
  fetchPublicModelEndpoint,
  isPrivateModelEndpointAddress,
  isPublicModelEndpointUrl,
} from "./endpoints.server.ts"

describe("model endpoint policy", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "::",
    "::1",
    "fd00:ec2::254",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateModelEndpointAddress(address)).toBe(true)
  })

  test.each(["8.8.8.8", "172.32.0.1", "2606:4700::1111", "api.openai.com"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateModelEndpointAddress(address)).toBe(false)
    },
  )

  test("refuses HTTP and literal private hosts before resolving them", () => {
    expect(isPublicModelEndpointUrl(new URL("https://api.openai.com/v1"))).toBe(true)
    for (const url of [
      "http://api.openai.com/v1",
      "https://169.254.169.254/latest",
      "https://[::1]:11434/v1",
      "https://0x7f.1/v1",
      "https://ollama.localhost/v1",
    ])
      expect(isPublicModelEndpointUrl(new URL(url))).toBe(false)
  })

  test("refuses a host that resolves to a private address without sending the request", async () => {
    const send = vi.spyOn(globalThis, "fetch")
    await expect(fetchPublicModelEndpoint("https://gateway.example/v1/responses")).rejects.toThrow(
      "does not resolve to a public HTTPS endpoint",
    )
    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
  })
})
