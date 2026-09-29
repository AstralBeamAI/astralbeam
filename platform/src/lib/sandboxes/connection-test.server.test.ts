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

const dockerTest = { provider: "docker", options: { image: "node:22" }, credentials: {} } as const

describe("runSandboxConnectionTest", () => {
  it.effect("destroys a created sandbox when the test is interrupted", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      const started = yield* Deferred.make<void>()
      connectionTestSandbox.exec.mockImplementation(() => {
        Deferred.doneUnsafe(started, Effect.void)
        return new Promise(() => {})
      })
      const fiber = yield* Effect.forkChild(runSandboxConnectionTest(dockerTest))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
    }),
  )

  it.effect("reports a hung command as a timeout after removing its sandbox", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      connectionTestSandbox.exec.mockImplementation(() => new Promise(() => {}))
      const fiber = yield* Effect.forkChild(runSandboxConnectionTest(dockerTest))
      yield* TestClock.adjust("15 seconds")
      const result = yield* Fiber.join(fiber)
      assert.deepInclude(result, { status: "failure", errorCode: "timeout" })
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
    }),
  )

  it.effect("destroys a sandbox whose create resolves after the timeout", () =>
    Effect.gen(function* () {
      connectionTestSandbox.destroy.mockClear()
      const late = Promise.withResolvers<unknown>()
      connectionTestSandbox.pendingCreate = late.promise
      const fiber = yield* Effect.forkChild(runSandboxConnectionTest(dockerTest))
      yield* TestClock.adjust("30 seconds")
      assert.deepInclude(yield* Fiber.join(fiber), { status: "failure", errorCode: "timeout" })
      connectionTestSandbox.pendingCreate = undefined
      late.resolve({ destroy: connectionTestSandbox.destroy })
      yield* Effect.promise(() => late.promise)
      assert.strictEqual(connectionTestSandbox.destroy.mock.calls.length, 1)
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
        const result = yield* runSandboxConnectionTest(dockerTest)
        assert.deepInclude(result, { status: "failure", errorCode: "authentication" })
      }
      connectionTestSandbox.createError = undefined
    }),
  )
})
