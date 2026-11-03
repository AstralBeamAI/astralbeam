import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"

const connectionTestSandbox = vi.hoisted(() => ({
  createError: undefined as Error | undefined,
  pendingCreate: undefined as Promise<unknown> | undefined,
  exec: vi.fn<() => Promise<{ exitCode: number; stdout: string }>>(),
  destroy: vi.fn(() => Promise.resolve()),
}))

vi.mock("./factory.server.ts", () => ({
  createSandboxProvider: () =>
    Effect.succeed({
      create: () =>
        connectionTestSandbox.pendingCreate ??
        (connectionTestSandbox.createError === undefined
          ? Promise.resolve({
              process: { exec: connectionTestSandbox.exec },
              destroy: connectionTestSandbox.destroy,
            })
          : Promise.reject(connectionTestSandbox.createError)),
    }),
}))

import { runSandboxConnectionTest } from "./connection-test.server.ts"

const e2bTest = {
  provider: "e2b",
  options: { template: "base" },
  credentials: { apiKey: "test-key" },
} as const

describe("runSandboxConnectionTest", () => {
  it.effect("reports failed cleanup after a successful connection test", () =>
    Effect.gen(function* () {
      connectionTestSandbox.exec.mockResolvedValue({ exitCode: 0, stdout: "sandbox-connection-ok" })
      connectionTestSandbox.destroy.mockRejectedValueOnce(new Error("Vendor cleanup failed"))
      assert.deepInclude(yield* runSandboxConnectionTest(e2bTest), {
        status: "failure",
        errorCode: "cleanup_failed",
      })
    }),
  )

  it.effect("destroys a created sandbox when the test is interrupted", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      const started = yield* Deferred.make<void>()
      connectionTestSandbox.exec.mockImplementation(() => {
        Deferred.doneUnsafe(started, Effect.void)
        return new Promise(() => {})
      })
      const fiber = yield* Effect.forkChild(runSandboxConnectionTest(e2bTest))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
    }),
  )

  it.effect("reports a hung command as a timeout after removing its sandbox", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      connectionTestSandbox.exec.mockImplementation(() => new Promise(() => {}))
      const fiber = yield* Effect.forkChild(runSandboxConnectionTest(e2bTest))
      yield* TestClock.adjust("15 seconds")
      const result = yield* Fiber.join(fiber)
      assert.deepInclude(result, { status: "failure", errorCode: "timeout" })
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
    }),
  )

  // A provider may finish provisioning after the caller has already timed out or disconnected.
  it.effect("destroys a sandbox whose create finishes after a timeout or interruption", () =>
    Effect.gen(function* () {
      for (const end of ["timeout", "interrupt"] as const) {
        connectionTestSandbox.destroy.mockClear()
        const late = Promise.withResolvers<unknown>()
        connectionTestSandbox.pendingCreate = late.promise
        const fiber = yield* Effect.forkChild(runSandboxConnectionTest(e2bTest))
        if (end === "timeout") {
          yield* TestClock.adjust("30 seconds")
          assert.deepInclude(yield* Fiber.join(fiber), { status: "failure", errorCode: "timeout" })
        } else {
          yield* TestClock.adjust("1 second")
          yield* Fiber.interrupt(fiber)
        }
        connectionTestSandbox.pendingCreate = undefined
        assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 0)
        late.resolve({ destroy: connectionTestSandbox.destroy })
        yield* Effect.promise(() => late.promise)
        assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1, end)
      }
    }),
  )

  it.effect("classifies vendor authentication failures", () =>
    Effect.gen(function* () {
      const vercel = Object.assign(new Error("Unauthorized"), {
        response: new Response(null, { status: 401 }),
      })
      const sprites = new Error("Sprites API POST https://api.sprites.dev failed: 403 Forbidden")
      const e2b = Object.assign(new Error("Unauthorized"), { status: 401 })
      for (const error of [vercel, sprites, e2b]) {
        connectionTestSandbox.createError = error
        const result = yield* runSandboxConnectionTest(e2bTest)
        assert.deepInclude(result, { status: "failure", errorCode: "authentication" })
      }
      connectionTestSandbox.createError = undefined
    }),
  )
})
