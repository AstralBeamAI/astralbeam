import { Layer, Logger, ManagedRuntime } from "effect"

import { Database } from "@/db/database.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { Agents } from "@/lib/agents/agents.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users.server"
import { Tenants } from "@/lib/tenants/tenants.server"

const LoggerLayer = Logger.layer([
  import.meta.env.DEV ? Logger.consolePretty() : Logger.consoleLogFmt,
])

/** Every service the application's Effects may require, built once per module graph. */
export const AppLayer = Layer.mergeAll(
  Agents.layer,
  Database.layer,
  DatabaseRateLimiter.layer,
  SandboxProviders.layer,
  Tenants.layer,
  TenantUsers.layer,
  LoggerLayer,
)

export type AppServices = Layer.Success<typeof AppLayer>

// Pools stay process-wide in `@/db`, so a module reload rebuilds only this layer's services.
// https://vite.dev/guide/api-hmr.html#hot-dispose-cb
let appRuntime: ManagedRuntime.ManagedRuntime<AppServices, never> | undefined

export function getAppRuntime() {
  return (appRuntime ??= ManagedRuntime.make(AppLayer.pipe(Layer.orDie)))
}

import.meta.hot?.dispose(() => void appRuntime?.dispose())
