import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { SandboxResources } from "./resources.server"

const connectionTestSandbox = vi.hoisted(() => ({
  createError: undefined as Error | undefined,
  pendingCreate: undefined as Promise<unknown> | undefined,
  exec: vi.fn<() => Promise<{ exitCode: number; stdout: string }>>(),
  destroy: vi.fn(() => Promise.resolve()),
}))

const testResources = Layer.succeed(SandboxResources, {
  provider: () =>
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
} as unknown as SandboxResources["Service"])

import { runSandboxConnectionTest } from "./connection-test.server.ts"

const dockerTest = {
  organizationId: "01992a80-1d71-7f24-a150-f1177e3f6419",
  provider: "docker",
  options: { image: "node:22" },
  credentials: {},
} as const
const runTest = () => runSandboxConnectionTest(dockerTest).pipe(Effect.provide(testResources))

describe("runSandboxConnectionTest", () => {
  it.effect("destroys a created sandbox when the test is interrupted", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      const started = yield* Deferred.make<void>()
      connectionTestSandbox.exec.mockImplementation(() => {
        Deferred.doneUnsafe(started, Effect.void)
        return new Promise(() => {})
      })
      const fiber = yield* Effect.forkChild(runTest())
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
    }),
  )

  it.effect("reports a hung command as a timeout after removing its sandbox", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      connectionTestSandbox.exec.mockImplementation(() => new Promise(() => {}))
      const fiber = yield* Effect.forkChild(runTest())
      yield* TestClock.adjust("15 seconds")
      const result = yield* Fiber.join(fiber)
      assert.deepInclude(result, { status: "failure", errorCode: "timeout" })
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
    }),
  )

  // Docker's adapter ignores the abort signal, so its create can still finish after the test ends.
  it.effect("destroys a sandbox whose create finishes after a timeout or interruption", () =>
    Effect.gen(function* () {
      for (const end of ["timeout", "interrupt"] as const) {
        connectionTestSandbox.destroy.mockClear()
        const late = Promise.withResolvers<unknown>()
        connectionTestSandbox.pendingCreate = late.promise
        const fiber = yield* Effect.forkChild(runTest())
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
      for (const error of [vercel, sprites]) {
        connectionTestSandbox.createError = error
        const result = yield* runTest()
        assert.deepInclude(result, { status: "failure", errorCode: "authentication" })
      }
      connectionTestSandbox.createError = undefined
    }),
  )
})
