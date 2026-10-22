import { Effect, Fiber, Layer } from "effect"
import { SandboxResources } from "./resources.server"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const connectionTestSandbox = vi.hoisted(() => ({
  createError: undefined as Error | undefined,
  pendingCreate: undefined as Promise<unknown> | undefined,
  exec: vi.fn<() => Promise<{ exitCode: number; stdout: string }>>(),
  destroy: vi.fn(() => Promise.resolve()),
}))

const testResources = Layer.succeed(SandboxResources, {
  provider: () =>
    Effect.succeed({
      destroy: connectionTestSandbox.destroy,
      create: () =>
        connectionTestSandbox.pendingCreate ??
        (connectionTestSandbox.createError === undefined
          ? Promise.resolve({
              id: "check-sandbox",
              process: { exec: connectionTestSandbox.exec },
              destroy: connectionTestSandbox.destroy,
            })
          : Promise.reject(connectionTestSandbox.createError)),
    }),
} as unknown as SandboxResources["Service"])

import { runSandboxConnectionTest } from "./connection-test.server.ts"

const dockerTest = {
  organizationId: "01992a80-1d71-7f24-a150-f1177e3f6419",
  provider: "docker",
  options: {},
  credentials: {},
} as const
const runTest = () => runSandboxConnectionTest(dockerTest).pipe(Effect.provide(testResources))
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  connectionTestSandbox.createError = undefined
  connectionTestSandbox.pendingCreate = undefined
  connectionTestSandbox.exec.mockResolvedValue({ exitCode: 0, stdout: "sandbox-connection-ok" })
  connectionTestSandbox.destroy.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe("runSandboxConnectionTest", () => {
  test("reports failed cleanup", async () => {
    connectionTestSandbox.destroy.mockRejectedValueOnce(new Error("Cleanup failed"))
    expect(await Effect.runPromise(runTest())).toMatchObject({
      status: "failure",
      errorCode: "cleanup_failed",
    })
  })

  test("waits for cleanup when interrupted", async () => {
    const started = Promise.withResolvers<void>()
    const cleanup = Promise.withResolvers<void>()
    connectionTestSandbox.exec.mockImplementation(() => {
      started.resolve()
      return new Promise(() => {})
    })
    connectionTestSandbox.destroy.mockReturnValueOnce(cleanup.promise)
    const fiber = Effect.runFork(runTest())
    await started.promise
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))
    await vi.advanceTimersByTimeAsync(0)
    expect(connectionTestSandbox.destroy).toHaveBeenCalledTimes(1)
    expect(fiber.pollUnsafe()).toBeUndefined()
    cleanup.resolve()
    await interrupted
  })

  test("cleans up after a command timeout", async () => {
    connectionTestSandbox.exec.mockImplementation(() => new Promise(() => {}))
    const pending = Effect.runPromise(runTest())
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await pending).toMatchObject({ status: "failure", errorCode: "timeout" })
    expect(connectionTestSandbox.destroy).toHaveBeenCalledTimes(1)
  })

  test("cleans up a create that completes after timeout or cancellation", async () => {
    for (const end of ["timeout", "interrupt"] as const) {
      connectionTestSandbox.destroy.mockClear()
      const late = Promise.withResolvers<unknown>()
      connectionTestSandbox.pendingCreate = late.promise
      const fiber = Effect.runFork(runTest())
      await vi.advanceTimersByTimeAsync(31_000)
      expect(fiber.pollUnsafe()).toBeUndefined()
      if (end === "timeout") {
        await vi.advanceTimersByTimeAsync(89_000)
        await Effect.runPromise(Fiber.await(fiber))
      } else await Effect.runPromise(Fiber.interrupt(fiber))
      expect(connectionTestSandbox.destroy).not.toHaveBeenCalled()
      late.resolve({ id: "late-sandbox" })
      await vi.advanceTimersByTimeAsync(0)
      expect(connectionTestSandbox.destroy).toHaveBeenCalledTimes(1)
    }
  })

  test("classifies vendor authentication failures", async () => {
    const errors = [
      Object.assign(new Error("Unauthorized"), { response: new Response(null, { status: 401 }) }),
      new Error("Sprites API POST https://api.sprites.dev failed: 403 Forbidden"),
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    ]
    for (const error of errors) {
      connectionTestSandbox.createError = error
      expect(await Effect.runPromise(runTest())).toMatchObject({
        status: "failure",
        errorCode: "authentication",
      })
    }
  })
})
