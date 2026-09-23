import "@tanstack/react-start/server-only"

import * as PgClient from "@effect/sql-pg/PgClient"
import { drizzle } from "drizzle-orm/node-postgres"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Redacted from "effect/Redacted"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import { Pool } from "pg"

import { getDatabaseUrl } from "./lib/database-credentials.server.ts"
import { databaseRelations } from "./schema.server.ts"

// Keep Better Auth and Effect connection lifecycles independent.
// https://effect.website/docs/v4/api/sql-pg/PgClient/
function createAuthDatabasePool(): Pool {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    application_name: "astralbeam-webapp-auth",
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Recycle connections before a NAT or PgBouncer idle timeout can drop them silently, and let
    // TCP keepalives surface the ones that still die while checked in.
    maxLifetimeSeconds: 1_800,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  // An unhandled 'error' event on a pg pool terminates the process.
  pool.on("error", (error) => {
    console.error("Database pool idle client error", {
      pool: "astralbeam-webapp-auth",
      message: error.message,
      code: "code" in error && typeof error.code === "string" ? error.code : undefined,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    })
  })
  return pool
}

// Nitro and TanStack SSR have separate module graphs in development. Share the pool owners.
// https://vite.dev/guide/api-environment-runtimes.html
const databaseResourcesKey = Symbol.for("webapp.databaseResources")
const databaseProcess = globalThis as typeof globalThis & {
  [databaseResourcesKey]?: ReturnType<typeof createDatabaseResources>
}
export const databaseResources = (databaseProcess[databaseResourcesKey] ??=
  createDatabaseResources())

export const db = drizzle({
  client: databaseResources.authPool,
  jit: true,
  relations: databaseRelations,
})

const makeEffectDatabase = PgDrizzle.makeWithDefaults({
  relations: databaseRelations,
  jit: true,
})

export type EffectDatabase = Effect.Success<typeof makeEffectDatabase>

export const effectDatabase = Context.Service<EffectDatabase>("@astralbeam/EffectDatabase")

export const effectDatabaseLayer = Layer.effect(effectDatabase, makeEffectDatabase)

// Cache only this module's production adapter so schema reloads and independent layers stay isolated.
// https://vite.dev/guide/api-hmr.html
const productionDatabase = Effect.runSync(
  Effect.cached(Effect.provide(effectDatabase, effectDatabaseLayer)),
)

function createDatabaseResources() {
  return {
    authPool: createAuthDatabasePool(),
    runtime: ManagedRuntime.make(
      PgClient.layer({
        url: Redacted.make(getDatabaseUrl()),
        applicationName: "astralbeam-webapp",
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

export function runDatabaseEffect<A, E>(
  effect: Effect.Effect<A, E, EffectDatabase | PgClient.PgClient | SqlClient.SqlClient>,
  options?: Effect.RunOptions,
): Promise<A> {
  return databaseResources.runtime.runPromise(
    Effect.provideServiceEffect(effect, effectDatabase, productionDatabase),
    options,
  )
}

export function closeDatabase(): Promise<void> {
  return (databaseResources.shutdown ??= Promise.all([
    databaseResources.runtime.dispose(),
    databaseResources.authPool.end(),
  ]).then(() => undefined))
}
