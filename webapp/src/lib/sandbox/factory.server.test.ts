import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sandboxFactoryMocks = vi.hoisted(() => ({
  daytonaSandbox: vi.fn(() => ({ name: "daytona" })),
  dockerSandbox: vi.fn(() => ({ name: "docker" })),
  spritesSandbox: vi.fn(() => ({ name: "sprites" })),
  vercelSandbox: vi.fn(() => ({ name: "vercel" })),
}))

vi.mock("@tanstack/ai-sandbox-daytona", () => ({
  daytonaSandbox: sandboxFactoryMocks.daytonaSandbox,
}))
vi.mock("@tanstack/ai-sandbox-docker", () => ({
  dockerSandbox: sandboxFactoryMocks.dockerSandbox,
}))
vi.mock("@tanstack/ai-sandbox-sprites", () => ({
  spritesSandbox: sandboxFactoryMocks.spritesSandbox,
}))
vi.mock("@tanstack/ai-sandbox-vercel", () => ({
  vercelSandbox: sandboxFactoryMocks.vercelSandbox,
}))

import { createSandboxProvider } from "./factory.server.ts"

describe("sandbox provider factory", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes validated database values directly to official initializers", async () => {
    const daytonaOptions = { target: "eu", snapshot: "daytona-medium" }
    await Effect.runPromise(createSandboxProvider("daytona", {
      options: daytonaOptions,
      credentials: { apiKey: "daytona-key" },
    }))
    expect(sandboxFactoryMocks.daytonaSandbox).toHaveBeenCalledWith({
      ...daytonaOptions,
      apiKey: "daytona-key",
    })

    const dockerOptions = { image: "custom/image:tag" }
    await Effect.runPromise(createSandboxProvider("docker", {
      options: dockerOptions,
      credentials: {},
    }))
    expect(sandboxFactoryMocks.dockerSandbox).toHaveBeenCalledWith(dockerOptions)

    await Effect.runPromise(createSandboxProvider("sprites", {
      options: {},
      credentials: { apiKey: "sprites-key" },
    }))
    expect(sandboxFactoryMocks.spritesSandbox).toHaveBeenCalledWith({ apiKey: "sprites-key" })

    const vercelOptions = {
      teamId: "team-id",
      projectId: "project-id",
      runtime: "node24",
    } as const
    await Effect.runPromise(createSandboxProvider("vercel", {
      options: vercelOptions,
      credentials: { token: "vercel-token" },
    }))
    expect(sandboxFactoryMocks.vercelSandbox).toHaveBeenCalledWith({
      ...vercelOptions,
      token: "vercel-token",
    })
  })
})
