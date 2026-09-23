import { Effect } from "effect"
import { expect, test, vi } from "vitest"

test("module reloads share database clients and a single shutdown", async () => {
  const original = await import("./index.ts")
  vi.resetModules()
  const reloaded = await import("./index.ts")
  const end = vi.spyOn(original.db.$client, "end")
  const dispose = vi.spyOn(original.databaseRuntime, "dispose")
  try {
    expect(reloaded.db).toBe(original.db)
    expect(reloaded.databaseRuntime).toBe(original.databaseRuntime)
    await expect(reloaded.runDatabaseEffect(Effect.succeed("ready"))).resolves.toBe("ready")
    const closing = original.closeProcessDatabaseServices()
    expect(reloaded.closeProcessDatabaseServices()).toBe(closing)
    await closing
    expect(end).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  } finally {
    await original.closeProcessDatabaseServices()
    vi.restoreAllMocks()
  }
})
