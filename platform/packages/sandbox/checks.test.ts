import { createServer } from "node:http"

import { DockerSandbox } from "@astralbeam/sandbox"
import { expect, test, vi } from "vitest"

test("checks DOCKER_HOST without Docker CLI and aborts an unresponsive daemon", async () => {
  let respond = true
  let closed = false
  const server = createServer((request, response) => {
    expect(request.url).toBe("/_ping")
    if (respond) response.end("OK")
    else
      response.on("close", () => {
        closed = true
      })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No test endpoint")
  vi.stubEnv("DOCKER_HOST", `tcp://127.0.0.1:${address.port}`)
  vi.stubEnv("DOCKER_TLS_VERIFY", undefined)
  vi.stubEnv("DOCKER_CERT_PATH", undefined)
  try {
    await expect(DockerSandbox.available()).resolves.toBe(true)
    respond = false
    await expect(DockerSandbox.available()).resolves.toBe(false)
    await vi.waitFor(() => expect(closed).toBe(true))
  } finally {
    vi.unstubAllEnvs()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
