import * as Effect from "effect/Effect"
import { expect, test, vi } from "vitest"

const sandboxFactoryMocks = vi.hoisted(() => ({
  docker: vi.fn(),
}))

vi.mock("@tanstack/ai-sandbox-docker", () => ({ dockerSandbox: sandboxFactoryMocks.docker }))

import { createSandboxProvider } from "./factory.server.ts"

test("uses a Docker keep-alive command that exits on SIGTERM", async () => {
  await Effect.runPromise(
    createSandboxProvider("docker", { options: { image: "custom/image:tag" }, credentials: {} }),
  )
  expect(sandboxFactoryMocks.docker).toHaveBeenCalledExactlyOnceWith({
    image: "custom/image:tag",
    keepAliveCommand: ["sh", "-c", "trap 'exit 0' TERM; tail -f /dev/null & wait"],
  })
})
