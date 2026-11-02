import process from "node:process"

import { assert, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { afterEach, vi } from "vitest"
import type { Plugin, ViteDevServer } from "vite"

import viteConfig from "./vite.config.ts"

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

it("retains development signal handlers until slow cleanup completes", async () => {
  const cleanup = Promise.withResolvers<void>()
  const signals = ["SIGINT", "SIGTERM"] as const
  const listeners = signals.map((signal) => process.listenerCount(signal))
  const plugin = viteConfig({ command: "serve", mode: "test" }).plugins!.find(
    (plugin) =>
      !Array.isArray(plugin) &&
      plugin &&
      "name" in plugin &&
      plugin.name === "cluster-development-close",
  ) as Plugin
  const server = {
    environments: { nitro: { devServer: { shutdown: () => cleanup.promise } } },
    close: async () => {
      await server.environments.nitro.devServer.close()
    },
  } as unknown as ViteDevServer
  const configure = plugin.configureServer as (server: ViteDevServer) => void
  configure(server)
  const closing = server.close()
  try {
    for (const [index, signal] of signals.entries())
      assert.strictEqual(process.listenerCount(signal), listeners[index]! + 1)
    assert.strictEqual(server.close(), closing)
  } finally {
    cleanup.resolve()
    await closing
  }
  for (const [index, signal] of signals.entries())
    assert.strictEqual(process.listenerCount(signal), listeners[index])
})
