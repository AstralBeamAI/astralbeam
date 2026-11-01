import process from "node:process"

import { assert, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { afterEach, vi } from "vitest"

import { supervisePlatformWorkers } from "./server.ts"

afterEach(() => {
  vi.restoreAllMocks()
})

it.effect("reports failed cleanup and kills stalled workers concurrently", () =>
  Effect.gen(function* () {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const workerSpawn = vi.spyOn(Bun, "spawn")
    for (const stalled of [false, true]) {
      const children = [105, 106].map((pid) => ({
        pid,
        exitCode: null as number | null,
        signalCode: null,
        ...Promise.withResolvers<number>(),
        kill: vi.fn<(signal: string) => void>(),
      }))
      for (const child of children) {
        child.kill.mockImplementation((signal: string) => {
          if (!stalled || signal === "SIGKILL") {
            child.exitCode = 1
            child.resolve(1)
          }
        })
        workerSpawn.mockReturnValueOnce({
          ...child,
          exited: child.promise,
        } as unknown as ReturnType<typeof Bun.spawn>)
      }
      const supervisor = yield* Effect.forkChild(
        supervisePlatformWorkers({ count: 2, command: ["/binary"] }),
      )
      yield* Effect.yieldNow
      process.listeners("SIGTERM").at(-1)!("SIGTERM")
      if (stalled) yield* TestClock.adjust("12 seconds")
      assert.strictEqual(yield* Fiber.join(supervisor), 1)
      for (const child of children)
        assert.deepStrictEqual(
          child.kill.mock.calls,
          stalled ? [["SIGTERM"], ["SIGKILL"]] : [["SIGTERM"]],
        )
    }
  }),
)
