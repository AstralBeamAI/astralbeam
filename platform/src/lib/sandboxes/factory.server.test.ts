import * as Effect from "effect/Effect"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { getAvailableSandboxProviderIds } from "./availability.server.ts"

const sandboxFactoryMocks = vi.hoisted(() => ({
  docker: vi.fn(),
  microsandbox: vi.fn(),
  checkDocker: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@astralbeam/sandbox", () => ({
  DockerSandbox: Object.assign(sandboxFactoryMocks.docker, {
    available: sandboxFactoryMocks.checkDocker,
  }),
  Microsandbox: sandboxFactoryMocks.microsandbox,
}))

import { createSandboxProvider } from "./factory.server.ts"

afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("LOCAL_SANDBOX_IMAGE", "operator/sandbox:tag")
  vi.stubEnv("DOCKERSANDBOX_DISABLED", undefined)
  sandboxFactoryMocks.checkDocker.mockResolvedValue(true)
})

test("offers Microsandbox only when startup approved its SDK", async () => {
  vi.stubEnv("__ASTRALBEAM_INTERNAL_MICROSANDBOX_SDK", undefined)
  const configuration = { options: {}, credentials: {} }

  expect(await getAvailableSandboxProviderIds()).not.toContain("microsandbox")
  const error = await Effect.runPromise(
    Effect.flip(createSandboxProvider("microsandbox", configuration)),
  )
  expect(error._tag).toBe("SandboxProviderUnavailable")
  expect(sandboxFactoryMocks.microsandbox).not.toHaveBeenCalled()
  vi.stubEnv("__ASTRALBEAM_INTERNAL_MICROSANDBOX_SDK", "/approved/runtime/index.js")

  expect(await getAvailableSandboxProviderIds()).toContain("microsandbox")
  await Effect.runPromise(createSandboxProvider("microsandbox", configuration))
  expect(sandboxFactoryMocks.microsandbox).toHaveBeenCalledExactlyOnceWith({
    image: "operator/sandbox:tag",
    sdkPath: "/approved/runtime/index.js",
  })
})

test("hides Docker and rejects its factory when disabled or unreachable", async () => {
  const configuration = { options: {}, credentials: {} }
  vi.stubEnv("DOCKERSANDBOX_DISABLED", "true")
  expect(await getAvailableSandboxProviderIds()).not.toContain("docker")
  expect(sandboxFactoryMocks.checkDocker).not.toHaveBeenCalled()
  expect(
    (await Effect.runPromise(Effect.flip(createSandboxProvider("docker", configuration))))._tag,
  ).toBe("SandboxProviderUnavailable")

  vi.stubEnv("DOCKERSANDBOX_DISABLED", undefined)
  sandboxFactoryMocks.checkDocker.mockResolvedValue(false)
  expect(await getAvailableSandboxProviderIds()).not.toContain("docker")
  expect(
    (await Effect.runPromise(Effect.flip(createSandboxProvider("docker", configuration))))._tag,
  ).toBe("SandboxProviderUnavailable")
  expect(sandboxFactoryMocks.docker).not.toHaveBeenCalled()
})

test("uses the operator image and a Docker keep-alive command that exits on SIGTERM", async () => {
  await Effect.runPromise(createSandboxProvider("docker", { options: {}, credentials: {} }))
  expect(sandboxFactoryMocks.docker).toHaveBeenCalledExactlyOnceWith({
    image: "operator/sandbox:tag",
    keepAliveCommand: ["sh", "-c", "trap 'exit 0' TERM; tail -f /dev/null & wait"],
  })
})
