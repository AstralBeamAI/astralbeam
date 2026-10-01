import { Layer, Logger, ManagedRuntime } from "effect"

import { IS_DEVELOPMENT_SERVER } from "./environment.server.ts"

import { Database } from "@/db/database.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { DatabaseMigrations } from "@/db/migration-runner.server"
import { Agents } from "@/lib/agents/agents.server"
import { ApiKeys } from "@/lib/api-keys/api-keys.server"
import { Auth } from "@/lib/auth/auth.server"
import { Chat } from "@/lib/chat/chat.server"
import { ChatSandboxes } from "@/lib/chat/sandbox/sandbox.server"
import { Config } from "@/lib/config/config.server"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import { Mailer } from "@/lib/email/email.server"
import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { Organizations } from "@/lib/organizations/organizations.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users.server"
import { Tenants } from "@/lib/tenants/tenants.server"

const LoggerLayer = Logger.layer([
  IS_DEVELOPMENT_SERVER ? Logger.consolePretty() : Logger.consoleLogFmt,
])

function makeAppLayer() {
  return Layer.mergeAll(
    Agents.layer,
    ApiKeys.layer,
    Auth.layer,
    Chat.layer,
    ChatSandboxes.layer,
    Config.layer,
    Database.layer,
    DatabaseMigrations.layer,
    DatabaseRateLimiter.layer,
    Dogfood.layer,
    Mailer.layer,
    Organizations.layer,
    ModelProviders.layer,
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

// Nitro plugins and request handlers load separate copies of this module, each with its own
// runtime, so shutdown disposes them all through this process-wide set.
const appRuntimesKey = Symbol.for("platform.appRuntimes")
type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>
const appRuntimes = ((globalThis as typeof globalThis & { [appRuntimesKey]?: Set<AppRuntime> })[
  appRuntimesKey
] ??= new Set())

// Pools stay process-wide in `src/db/database.server.ts`, so a reload rebuilds only these services.
// https://vite.dev/guide/api-hmr.html#hot-dispose-cb
let appRuntime: AppRuntime | undefined

export function getAppRuntime() {
  if (appRuntime) return appRuntime
  appRuntime = ManagedRuntime.make(getAppLayer().pipe(Layer.orDie))
  appRuntimes.add(appRuntime)
  return appRuntime
}

function disposeRuntime(runtime: AppRuntime): Promise<void> {
  appRuntimes.delete(runtime)
  return runtime.dispose()
}

/** Runs every copy's finalizers, such as destroying chat sandboxes, without closing the pools. */
export async function disposeAppRuntimes(): Promise<void> {
  appRuntime = undefined
  await Promise.all([...appRuntimes].map(disposeRuntime))
}

import.meta.hot?.dispose(() => {
  if (appRuntime) void disposeRuntime(appRuntime)
  appRuntime = undefined
})
