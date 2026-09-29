import { Layer, Logger, ManagedRuntime } from "effect"

import { Database } from "@/db/database.server"
import { Agents } from "@/lib/agents/agents.server"

const LoggerLayer = Logger.layer([
  import.meta.env.DEV ? Logger.consolePretty() : Logger.consoleLogFmt,
])

/** Every service the application's Effects may require, built once per module graph. */
const AppLayer = Layer.mergeAll(Agents.layer, Database.layer, LoggerLayer)

export type AppServices = Layer.Success<typeof AppLayer>

// Pools stay process-wide in `@/db`, so a module reload rebuilds only this layer's services.
// https://vite.dev/guide/api-hmr.html#hot-dispose-cb
let appRuntime: ManagedRuntime.ManagedRuntime<AppServices, never> | undefined

export function getAppRuntime() {
  return (appRuntime ??= ManagedRuntime.make(AppLayer.pipe(Layer.orDie)))
}

import.meta.hot?.dispose(() => void appRuntime?.dispose())
