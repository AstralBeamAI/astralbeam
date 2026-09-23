import process from "node:process"
import { Effect } from "effect"
import { expect, test, vi } from "vitest"
import clusterPlugin from "../../src/cluster/plugin.server.ts"

const clusterShutdownMocks = vi.hoisted(() => ({ close: vi.fn(), runFork: vi.fn() }))
vi.mock("@/db", () => ({
  closeProcessDatabaseServices: clusterShutdownMocks.close,
  databaseRuntime: { runFork: clusterShutdownMocks.runFork },
}))

test("signal shutdown leaves shared databases open until HTTP has drained", async () => {
  vi.stubEnv("NODE_ENV", "production")
  vi.stubEnv("CLUSTER_ENABLED", "true")
  const worker = Effect.runFork(Effect.never)
  clusterShutdownMocks.runFork.mockReturnValue(worker)
  const hooks = new Map<string, (...args: unknown[]) => unknown>()
  const previous = process.listeners("SIGTERM")
  const drained = Promise.withResolvers<void>()
  try {
    clusterPlugin({
      fetch: () => new Response(),
      hooks: {
        hook: (name: string, handler: (...args: unknown[]) => unknown) => hooks.set(name, handler),
      },
    } as unknown as Parameters<typeof clusterPlugin>[0])
    await hooks.get("request")!({
      req: { runtime: { deno: { server: { finished: drained.promise } } } },
    })
    const signal = process.listeners("SIGTERM").find((listener) => !previous.includes(listener))!
    signal("SIGTERM")
    await vi.waitFor(() => expect(worker.pollUnsafe()).toBeDefined())
    expect(clusterShutdownMocks.close).not.toHaveBeenCalled()
    drained.resolve()
    await vi.waitFor(() => expect(clusterShutdownMocks.close).toHaveBeenCalledOnce())
  } finally {
    drained.resolve()
    await hooks.get("close")?.()
    vi.unstubAllEnvs()
  }
})
