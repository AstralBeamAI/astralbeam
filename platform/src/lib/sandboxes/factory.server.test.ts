import * as Effect from "effect/Effect"
import { expect, test, vi } from "vitest"

const sandboxFactoryMocks = vi.hoisted(() => ({
  docker: vi.fn(),
  e2b: vi.fn(),
}))

vi.mock("@tanstack/ai-sandbox-docker", () => ({ dockerSandbox: sandboxFactoryMocks.docker }))
vi.mock("@tanstack/ai-sandbox-e2b", () => ({ e2bSandbox: sandboxFactoryMocks.e2b }))

import { createSandboxProvider } from "./factory.server.ts"

test("passes the stored E2B template and credential to its adapter", async () => {
  await Effect.runPromise(
    createSandboxProvider("e2b", {
      options: { template: "organization-template" },
      credentials: { apiKey: "organization-key" },
    }),
  )
  expect(sandboxFactoryMocks.e2b).toHaveBeenCalledExactlyOnceWith({
    template: "organization-template",
    apiKey: "organization-key",
  })
})

test("uses a Docker keep-alive command that exits on SIGTERM", async () => {
  await Effect.runPromise(
    createSandboxProvider("docker", { options: { image: "custom/image:tag" }, credentials: {} }),
  )
  expect(sandboxFactoryMocks.docker).toHaveBeenCalledExactlyOnceWith({
    image: "custom/image:tag",
    keepAliveCommand: ["sh", "-c", "trap 'exit 0' TERM; tail -f /dev/null & wait"],
  })
})
