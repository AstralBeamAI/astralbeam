import { createServer } from "node:http"

import { daytonaSandbox } from "@tanstack/ai-sandbox-daytona"
import { dockerSandbox } from "@tanstack/ai-sandbox-docker"
import { vercelSandbox } from "@tanstack/ai-sandbox-vercel"
import { expect, test, vi } from "vitest"

test("patched adapters preserve ownership names and distinguish missing resources from outages", async () => {
  let status = 403
  const requests: { path: string; body: string }[] = []
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk: unknown) => {
      body += String(chunk)
    })
    request.on("end", () => {
      requests.push({ path: request.url ?? "", body })
      response.writeHead(request.url?.startsWith("/images/") ? 200 : status, {
        "content-type": "application/json",
      })
      response.end(
        JSON.stringify({ error: { code: "test_error", message: "test provider response" } }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP listener")
  const origin = `http://127.0.0.1:${address.port}`
  const originalFetch = globalThis.fetch
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    return originalFetch(`${origin}${url.pathname}${url.search}`, init)
  })
  try {
    const docker = dockerSandbox({
      image: "node:22",
      dockerodeOptions: { host: "127.0.0.1", port: address.port, protocol: "http" },
    })
    const vercel = vercelSandbox({
      token: "test-token",
      teamId: "test-team",
      projectId: "test-project",
    })
    const providers = [docker, vercel, daytonaSandbox({ apiKey: "test-key", apiUrl: origin })]
    for (const provider of providers) {
      await expect(provider.destroy({ id: "owned-sandbox" })).rejects.toThrow()
      await expect(provider.resume({ id: "owned-sandbox" })).rejects.toThrow()
    }
    await expect(docker.create({ id: "owned-sandbox" })).rejects.toThrow()
    await expect(vercel.create({ id: "owned-sandbox" })).rejects.toThrow()
    expect(
      requests.some(({ path }) => path.includes("/containers/create?name=owned-sandbox")),
    ).toBe(true)
    expect(requests.some(({ body }) => body.includes('"name":"owned-sandbox"'))).toBe(true)
    status = 404
    for (const provider of providers) {
      await expect(provider.destroy({ id: "owned-sandbox" })).resolves.toBeUndefined()
      await expect(provider.resume({ id: "owned-sandbox" })).resolves.toBeNull()
    }
  } finally {
    vi.unstubAllGlobals()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
