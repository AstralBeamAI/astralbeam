import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
import { Layer, ManagedRuntime } from "effect"

import { serverLoggerLayer } from "./logging.server.ts"
import { telemetryLayer } from "./telemetry.server.ts"

import { Database } from "@/db/database"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { DatabaseMigrations } from "@/db/migration-runner"
import { Agents } from "@/lib/agents/agents.server"
import { ApiKeys } from "@/lib/api-keys/api-keys.server"
import { Auth } from "@/lib/auth/auth.server"
import { ChatFiles } from "@/lib/chat/attachments/attachments"
import { Chat } from "@/lib/chat/chat"
import { ChatThreads } from "@/lib/chat/threads/threads"
import { ChatSandboxes } from "@/lib/chat/sandbox/sandbox"
import { Config } from "@/lib/config/config"
import { Dogfood } from "@/lib/dogfood/dogfood.server"
import { Mailer } from "@/lib/email/email.server"
import { McpConnections } from "@/lib/mcp/mcp.server"
import { McpAuthorization } from "@/lib/mcp/authorization.server"
import { McpTools } from "@/lib/mcp/tools.server"
import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { Organizations } from "@/lib/organizations/organizations.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { TenantUsers } from "@/lib/tenants/tenant-users"
import { Tenants } from "@/lib/tenants/tenants"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { ImageSources } from "@/lib/storage/image-source.server"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"

// Defer service references past Better Auth's import cycle and share construction with REST.
// https://effect.website/docs/v4/api/effect/Layer#suspend
export const appLayer = Layer.suspend(() =>
  Layer.mergeAll(
    Agents.layer,
    ApiKeys.layer,
    Auth.layer,
    Chat.layer,
    ChatFiles.layer,
    ChatThreads.layer,
    ChatSandboxes.layer,
    Config.layer,
    Database.layer,
    DatabaseMigrations.layer,
    DatabaseRateLimiter.layer,
    Dogfood.layer,
    Mailer.layer,
    ObjectStorage.layer,
    StoredFiles.layer,
    ImageSources.layer,
    Organizations.layer,
    ModelProviders.layer,
    McpConnections.layer,
    McpAuthorization.layer,
    McpTools.layer,
    SandboxProviders.layer,
    Tenants.layer,
    TenantUsers.layer,
    UsageLimits.layer,
    BunHttpClient.layer,
    serverLoggerLayer,
  ).pipe(Layer.provideMerge(telemetryLayer.pipe(Layer.provide(Config.layer)))),
)

export type AppServices = Layer.Success<typeof appLayer>

// Nitro plugins and request handlers load separate copies of this module, each with its own
// runtime, so shutdown disposes them all through this process-wide set.
const appRuntimesKey = Symbol.for("platform.appRuntimes")
type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, never>
const appRuntimes = ((globalThis as typeof globalThis & { [appRuntimesKey]?: Set<AppRuntime> })[
  appRuntimesKey
] ??= new Set())

// Pools stay process-wide in `src/db/database.ts`, so a reload rebuilds only these services.
// https://vite.dev/guide/api-hmr.html#hot-dispose-cb
let appRuntime: AppRuntime | undefined

export function getAppRuntime() {
  if (appRuntime) return appRuntime
  appRuntime = ManagedRuntime.make(appLayer.pipe(Layer.orDie))
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
