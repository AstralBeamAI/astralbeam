import * as PgClient from "@effect/sql-pg/PgClient"
import { drizzle } from "drizzle-orm/node-postgres"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Redacted from "effect/Redacted"
import { Pool } from "pg"

import { getDatabaseUrl } from "./lib/database-credentials.server.ts"
import { sqlState } from "./lib/sqlstate.server.ts"
import { databaseRelations } from "./schema.server.ts"

// Keep Better Auth and Effect connection lifecycles independent.
// https://effect.website/docs/v4/api/sql-pg/PgClient/
function createAuthDatabasePool(): Pool {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    application_name: "astralbeam-platform-auth",
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Recycle connections before a NAT or PgBouncer idle timeout can drop them silently, and let
    // TCP keepalives surface the ones that still die while checked in.
    maxLifetimeSeconds: 1_800,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  // An unhandled 'error' event on a pg pool terminates the process. Log its code, not its message.
  pool.on("error", (error) => {
    Effect.runFork(
      Effect.logError("Database pool idle client error").pipe(
        Effect.annotateLogs({
          pool: "astralbeam-platform-auth",
          code: sqlState(error),
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        }),
      ),
    )
  })
  return pool
}

// Nitro and TanStack SSR have separate module graphs in development. Share the pool owners.
// https://vite.dev/guide/api-environment-runtimes.html
const databaseResourcesKey = Symbol.for("platform.databaseResources")
const databaseProcess = globalThis as typeof globalThis & {
  [databaseResourcesKey]?: ReturnType<typeof createDatabaseResources>
}
function getDatabaseResources() {
  return (databaseProcess[databaseResourcesKey] ??= createDatabaseResources())
}

function createAuthDatabase() {
  return drizzle({
    client: getDatabaseResources().authPool,
    jit: true,
    relations: databaseRelations,
  })
}

let authDatabase: ReturnType<typeof createAuthDatabase> | undefined

export function getAuthDatabase() {
  return (authDatabase ??= createAuthDatabase())
}

const makeEffectDatabase = PgDrizzle.makeWithDefaults({
  relations: databaseRelations,
  jit: true,
})

export type EffectDatabase = Effect.Success<typeof makeEffectDatabase>

/** Borrows the process-wide PgClient, so every module graph's runtime shares one pool. */
const SqlClientLayer = Layer.effectContext(
  Effect.suspend(() => getDatabaseResources().runtime.contextEffect),
)

export class Database extends Context.Service<Database, EffectDatabase>()(
  "astralbeam/db/Database",
) {
  static readonly layerNoDeps = Layer.effect(Database, makeEffectDatabase)
  static readonly layer = Database.layerNoDeps.pipe(Layer.provideMerge(SqlClientLayer))
}

function createDatabaseResources() {
  return {
    authPool: createAuthDatabasePool(),
    runtime: ManagedRuntime.make(
      PgClient.layer({
        url: Redacted.make(getDatabaseUrl()),
        applicationName: "astralbeam-platform",
        maxConnections: 10,
        connectTimeout: "5 seconds",
        idleTimeout: "30 seconds",
        connectionTTL: "30 minutes",
        prepare: false,
      }),
    ),
    shutdown: undefined as Promise<void> | undefined,
  }
}

export function closeDatabase(): Promise<void> {
  const databaseResources = databaseProcess[databaseResourcesKey]
  if (!databaseResources) return Promise.resolve()
  return (databaseResources.shutdown ??= Promise.all([
    databaseResources.runtime.dispose(),
    databaseResources.authPool.end(),
  ]).then(() => undefined))
}
