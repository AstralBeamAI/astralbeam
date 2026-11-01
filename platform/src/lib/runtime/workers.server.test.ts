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

it.effect("kills stalled workers concurrently at the shutdown deadline and reports failure", () =>
  Effect.gen(function* () {
    const hung = [mockPlatformWorker(105), mockPlatformWorker(106)] as const
    for (const child of hung)
      child.kill.mockImplementation((signal: string) => {
        if (signal === "SIGKILL") {
          child.signalCode = signal
          child.emit("exit", null)
        }
        return true
      })
    workerSpawn.mockReturnValueOnce(hung[0]).mockReturnValueOnce(hung[1])
    vi.spyOn(console, "error").mockImplementation(() => {})
    const supervisor = yield* Effect.forkChild(
      supervisePlatformWorkers({ count: 2, command: ["/binary"] }),
    )
    yield* Effect.yieldNow
    process.listeners("SIGTERM").at(-1)!("SIGTERM")
    yield* TestClock.adjust("12 seconds")
    assert.strictEqual(yield* Fiber.join(supervisor), 1)
    for (const child of hung)
      assert.deepStrictEqual(child.kill.mock.calls, [["SIGTERM"], ["SIGKILL"]])
  }),
)

it.effect("reports worker cleanup failures", () =>
  Effect.gen(function* () {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const child = mockPlatformWorker(107)
    child.kill.mockImplementation(() => {
      child.exitCode = 1
      child.emit("exit", 1)
      return true
    })
    workerSpawn.mockReturnValueOnce(child)
    const supervisor = yield* Effect.forkChild(
      supervisePlatformWorkers({ count: 1, command: ["/binary"] }),
    )
    yield* Effect.yieldNow
    process.listeners("SIGTERM").at(-1)!("SIGTERM")
    assert.strictEqual(yield* Fiber.join(supervisor), 1)
  }),
)
