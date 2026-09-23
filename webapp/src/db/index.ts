import "@tanstack/react-start/server-only"

import * as PgClient from "@effect/sql-pg/PgClient"
import { drizzle } from "drizzle-orm/node-postgres"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Redacted from "effect/Redacted"
import { Pool } from "pg"

import { getDatabaseUrl } from "@/db/lib/database-credentials.server"
import { databaseRelations } from "@/db/schema.server"

const makeEffectDatabase = PgDrizzle.makeWithDefaults({
  relations: databaseRelations,
  jit: true,
})

export type EffectDatabase = Effect.Success<typeof makeEffectDatabase>

export const effectDatabase = Context.Service<EffectDatabase>("@astralbeam/EffectDatabase")

function createProcessDatabaseServices() {
  const databaseUrl = getDatabaseUrl()
  const databaseConnectTimeoutMs = 5_000
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "astralbeam-webapp-auth",
    max: 5,
    connectionTimeoutMillis: databaseConnectTimeoutMs,
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
  const db = drizzle({ client: pool, jit: true, relations: databaseRelations })
  // Keep Better Auth and Effect connection lifecycles independent.
  // https://effect.website/docs/v4/api/sql-pg/PgClient/
  const runtime = ManagedRuntime.make(
    Layer.effect(effectDatabase, makeEffectDatabase).pipe(
      Layer.provideMerge(
        PgClient.layer({
          url: Redacted.make(databaseUrl),
          applicationName: "astralbeam-webapp",
          maxConnections: 10,
          connectTimeout: databaseConnectTimeoutMs,
          idleTimeout: "30 seconds",
          connectionTTL: "30 minutes",
          prepare: false,
        }),
      ),
    ),
  )
  return { db, runtime, closing: undefined as Promise<void> | undefined }
}

// Share clients and lifecycle state across Nitro and Vite SSR bundles in the same process.
// https://github.com/nitrojs/nitro/blob/main/src/vite.ts
const databaseKey = Symbol.for("astralbeam/database-services")
const databaseGlobal = globalThis as typeof globalThis & {
  [databaseKey]?: ReturnType<typeof createProcessDatabaseServices>
}
const databaseServices = (databaseGlobal[databaseKey] ??= createProcessDatabaseServices())

export const db = databaseServices.db
export const databaseRuntime = databaseServices.runtime
export const runDatabaseEffect = databaseRuntime.runPromise

export function closeProcessDatabaseServices(): Promise<void> {
  return (databaseServices.closing ??= Promise.all([
    databaseRuntime.dispose(),
    db.$client.end(),
  ]).then(() => undefined))
}
