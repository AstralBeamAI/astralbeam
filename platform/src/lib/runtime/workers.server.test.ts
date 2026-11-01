import { EventEmitter } from "node:events"
import process from "node:process"

import { assert, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { afterEach, vi } from "vitest"

const workerSpawn = vi.hoisted(() => vi.fn<() => ReturnType<typeof mockPlatformWorker>>())
vi.mock("node:child_process", () => ({ spawn: workerSpawn }))

import { supervisePlatformWorkers } from "./workers.server.ts"

afterEach(() => {
  vi.restoreAllMocks()
  workerSpawn.mockReset()
})

function mockPlatformWorker(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn<(signal: string) => boolean>(),
  })
}

it.effect("reports failed cleanup and kills stalled workers concurrently", () =>
  Effect.gen(function* () {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const stalled of [false, true]) {
      const children = [mockPlatformWorker(105), mockPlatformWorker(106)]
      for (const child of children) {
        child.kill.mockImplementation((signal: string) => {
          if (!stalled || signal === "SIGKILL") {
            child.exitCode = 1
            child.emit("exit", 1)
          }
          return true
        })
        workerSpawn.mockReturnValueOnce(child)
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
