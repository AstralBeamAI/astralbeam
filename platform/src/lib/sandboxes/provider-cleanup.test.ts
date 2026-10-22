import { createServer } from "node:http"

import {
  DaytonaSandbox,
  DockerSandbox,
  VercelSandbox,
  E2BSandbox,
  SpritesSandbox,
} from "@astralbeam/sandbox"
import { expect, test, vi } from "vitest"

test("provider adapters preserve ownership names and distinguish missing resources from outages", async () => {
  let status = 403
  let e2bId: string | undefined
  const requests: { path: string; body: string }[] = []
  const server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk: unknown) => {
      body += String(chunk)
    })
    request.on("end", () => {
      requests.push({ path: request.url ?? "", body })
      if (request.url === "/version") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ Components: [{ Name: "Docker Engine" }] }))
        return
      }
      if (request.url === "/info") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ID: "test-daemon" }))
        return
      }
      if (request.url?.startsWith("/v2/sandboxes?") && status !== 403) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify(
            e2bId
              ? [
                  {
                    sandboxID: e2bId,
                    templateID: "test",
                    metadata: { "tanstack-ai-key": "owned-sandbox" },
                    startedAt: new Date().toISOString(),
                    endAt: new Date().toISOString(),
                    state: "running",
                    cpuCount: 1,
                    memoryMB: 128,
                    envdVersion: "0.0.0",
                  },
                ]
              : [],
          ),
        )
        return
      }
      if (e2bId && request.url === `/sandboxes/${e2bId}` && request.method === "DELETE") {
        response.writeHead(204)
        response.end()
        return
      }
      response.writeHead(request.url?.startsWith("/images/") ? 200 : status, {
        "content-type": "application/json",
      })
      response.end(
        JSON.stringify({
          code: status,
          message: "test provider response",
          error: { code: "test_error", message: "test provider response" },
        }),
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
    const dockerConnection = new DockerSandbox({
      image: "node:22",
      dockerodeOptions: { host: "127.0.0.1", port: address.port, protocol: "http" },
    })
    const docker = await dockerConnection.provider
    expect(await dockerConnection.resourceScope).toBe("docker:test-daemon")
    const vercel = await new VercelSandbox({
      token: "test-token",
      teamId: "test-team",
      projectId: "test-project",
    }).provider
    const e2b = await new E2BSandbox({ apiKey: "test-key", apiUrl: origin }).provider
    const providers = [
      docker,
      vercel,
      e2b,
      await new SpritesSandbox({ apiKey: "test-key", apiUrl: origin }).provider,
      await new DaytonaSandbox({ apiKey: "test-key", apiUrl: origin }).provider,
    ]
    for (const provider of providers) {
      await expect(provider.destroy({ id: "owned-sandbox" })).rejects.toThrow()
      await expect(provider.resume({ id: "owned-sandbox" })).rejects.toThrow()
    }
    await expect(docker.create({ id: "owned-sandbox" })).rejects.toThrow()
    await expect(vercel.create({ id: "owned-sandbox" })).rejects.toThrow()
    expect(
      requests.some(
        ({ path }) =>
          new URL(path, origin).pathname === "/containers/create" &&
          new URL(path, origin).searchParams.get("name") === "owned-sandbox",
      ),
    ).toBe(true)
    expect(requests.some(({ body }) => body.includes('"name":"owned-sandbox"'))).toBe(true)
    status = 404
    for (const provider of providers) {
      await expect(provider.destroy({ id: "owned-sandbox" })).resolves.toBeUndefined()
      await expect(provider.resume({ id: "owned-sandbox" })).resolves.toBeNull()
    }
    e2bId = "native-sandbox"
    await expect(e2b.destroy({ id: "owned-sandbox" })).resolves.toBeUndefined()
    expect(requests.some(({ path }) => path === `/sandboxes/${e2bId}`)).toBe(true)
    expect(
      requests.some(
        ({ path }) =>
          path.startsWith("/v2/sandboxes") &&
          decodeURIComponent(path).includes("tanstack-ai-key=owned-sandbox"),
      ),
    ).toBe(true)
  } finally {
    vi.unstubAllGlobals()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
