import { Layer, Logger, ManagedRuntime } from "effect"

import { Database } from "@/db/database.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { Agents } from "@/lib/agents/agents.server"
import { Chat } from "@/lib/chat/chat.server"
import { ChatSandboxes } from "@/lib/chat/sandbox.server"
import { Mailer } from "@/lib/email/email.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users.server"
import { Tenants } from "@/lib/tenants/tenants.server"

const LoggerLayer = Logger.layer([
  import.meta.env.DEV ? Logger.consolePretty() : Logger.consoleLogFmt,
])

/** Every service the application's Effects may require, built once per module graph. */
export const AppLayer = Layer.mergeAll(
  Agents.layer,
  Chat.layer,
  ChatSandboxes.layer,
  Database.layer,
  DatabaseRateLimiter.layer,
  Mailer.layer,
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

/** Runs the services' finalizers, such as destroying chat sandboxes, without closing the pools. */
export function disposeAppRuntime(): Promise<void> {
  const runtime = appRuntime
  appRuntime = undefined
  return runtime ? runtime.dispose() : Promise.resolve()
}

import.meta.hot?.dispose(() => void disposeAppRuntime())
