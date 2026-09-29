import * as Effect from "effect/Effect"
import { expect, test, vi } from "vitest"

const sandboxFactoryMocks = vi.hoisted(() => ({
  daytona: vi.fn(),
  docker: vi.fn(),
  sprites: vi.fn(),
  vercel: vi.fn(),
}))

vi.mock("@tanstack/ai-sandbox-daytona", () => ({ daytonaSandbox: sandboxFactoryMocks.daytona }))
vi.mock("@tanstack/ai-sandbox-docker", () => ({ dockerSandbox: sandboxFactoryMocks.docker }))
vi.mock("@tanstack/ai-sandbox-sprites", () => ({ spritesSandbox: sandboxFactoryMocks.sprites }))
vi.mock("@tanstack/ai-sandbox-vercel", () => ({ vercelSandbox: sandboxFactoryMocks.vercel }))

import { createSandboxProvider } from "./factory.server.ts"

test.each([
  {
    provider: "daytona",
    options: { target: "eu", snapshot: "daytona-medium" },
    credentials: { apiKey: "daytona-key" },
    expected: { target: "eu", snapshot: "daytona-medium", apiKey: "daytona-key" },
  },
  {
    provider: "docker",
    options: { image: "custom/image:tag" },
    credentials: {},
    expected: { image: "custom/image:tag" },
  },
  {
    provider: "sprites",
    options: {},
    credentials: { apiKey: "sprites-key" },
    expected: { apiKey: "sprites-key" },
  },
  {
    provider: "vercel",
    options: { teamId: "team-id", projectId: "project-id", runtime: "node24" },
    credentials: { token: "vercel-token" },
    expected: {
      teamId: "team-id",
      projectId: "project-id",
      runtime: "node24",
      token: "vercel-token",
    },
  },
] as const)(
  "passes $provider options and credentials to its adapter",
  async ({ provider, options, credentials, expected }) => {
    await Effect.runPromise(createSandboxProvider(provider, { options, credentials }))
    expect(sandboxFactoryMocks[provider]).toHaveBeenCalledExactlyOnceWith(expected)
  },
)
