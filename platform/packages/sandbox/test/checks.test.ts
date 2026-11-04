import { createServer } from "node:http"

import { DockerSandbox } from "@astralbeam/sandbox"
import { expect, test, vi } from "vitest"

test("Docker exec and spawn inherit image environment and preserve explicit overrides", async () => {
  const environments: string[][] = []
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json")
    if (request.url === "/containers/environment-probe/json") {
      response.end(JSON.stringify({ State: { Running: true } }))
      return
    }
    if (request.url === "/containers/environment-probe/exec") {
      let body = ""
      request.on("data", (chunk) => {
        body += String(chunk)
      })
      request.on("end", () => {
        environments.push((JSON.parse(body) as { Env: string[] }).Env)
        // Stop at exec creation: the Docker API inherits image values absent from Env.
        response.writeHead(500).end(JSON.stringify({ message: "environment probe complete" }))
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No test endpoint")
  try {
    const connection = new DockerSandbox({
      image: "customer/image:tag",
      dockerodeOptions: { host: "127.0.0.1", port: address.port },
    })
    const handle = await (await connection.provider).resume({ id: "environment-probe" })
    if (!handle) throw new Error("No test handle")
    await expect(handle.process.exec("true")).rejects.toThrow("environment probe complete")
    expect(environments.pop()).toEqual([])

    await handle.env.set({ HOME: "/home/customer", SANDBOX_SETTING: "handle" })
    const options = { env: { PATH: "/custom/bin", SANDBOX_SETTING: "command" } }
    await expect(handle.process.exec("true", options)).rejects.toThrow("environment probe complete")
    await expect(handle.process.spawn("true", options)).rejects.toThrow(
      "environment probe complete",
    )
    expect(environments).toEqual([
      ["HOME=/home/customer", "SANDBOX_SETTING=command", "PATH=/custom/bin"],
      ["HOME=/home/customer", "SANDBOX_SETTING=command", "PATH=/custom/bin"],
    ])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

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
