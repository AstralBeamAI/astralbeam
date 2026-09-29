import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"

const connectionTestSandbox = vi.hoisted(() => ({
  exec: vi.fn<() => Promise<{ exitCode: number; stdout: string }>>(),
  destroy: vi.fn(() => Promise.resolve()),
}))

vi.mock("./factory.server.ts", () => ({
  createSandboxProvider: () =>
    Effect.succeed({
      create: () =>
        Promise.resolve({
          process: { exec: connectionTestSandbox.exec },
          destroy: connectionTestSandbox.destroy,
        }),
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
})
