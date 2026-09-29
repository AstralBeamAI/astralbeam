import { Layer, Logger, ManagedRuntime } from "effect"

import { Database } from "@/db/database.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { Agents } from "@/lib/agents/agents.server"
import { ApiKeys } from "@/lib/api-keys/api-keys.server"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config.server"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import { Organizations } from "@/lib/organizations/organizations.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users.server"
import { Tenants } from "@/lib/tenants/tenants.server"

const LoggerLayer = Logger.layer([
  import.meta.env.DEV ? Logger.consolePretty() : Logger.consoleLogFmt,
])

function makeAppLayer() {
  return Layer.mergeAll(
    Agents.layer,
    ApiKeys.layer,
    Auth.layer,
    Config.layer,
    Database.layer,
    DatabaseRateLimiter.layer,
    Dogfood.layer,
    Organizations.layer,
    SandboxProviders.layer,
    Tenants.layer,
    TenantUsers.layer,
    LoggerLayer,
  )
}

let appLayer: ReturnType<typeof makeAppLayer> | undefined

/**
 * Every service the application's Effects may require. Built on first use, because Better Auth
 * callbacks import this module from inside the services it merges.
 */
export function getAppLayer() {
  return (appLayer ??= makeAppLayer())
}

export type AppServices = Layer.Success<ReturnType<typeof makeAppLayer>>

// Pools stay process-wide in `@/db`, so a module reload rebuilds only this layer's services.
// https://vite.dev/guide/api-hmr.html#hot-dispose-cb
let appRuntime: ManagedRuntime.ManagedRuntime<AppServices, never> | undefined

export function getAppRuntime() {
  return (appRuntime ??= ManagedRuntime.make(getAppLayer().pipe(Layer.orDie)))
}

import.meta.hot?.dispose(() => void appRuntime?.dispose())
