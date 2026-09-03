import "@tanstack/react-start/server-only"

import * as PgClient from "@effect/sql-pg/PgClient"
import { drizzle } from "drizzle-orm/node-postgres"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Pool } from "pg"

import { getDatabaseUrl } from "@/db/lib/database-credentials.server"
import { databaseRelations } from "@/db/schema.server"

// Better Auth's Drizzle adapter and the Effect SQL client take pooled connections on different
// terms: the Effect client cancels the running query and releases or destroys its client whenever a
// fiber is interrupted, so on a shared pool an aborted request can leave behind a connection that
// later serves a session lookup as "Client was closed and is not queryable". Give each driver its
// own pool so neither one's client lifecycle reaches the other's queries.
// https://node-postgres.com/apis/pool
function createDatabasePool(applicationName: string, max: number): Pool {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    application_name: applicationName,
    max,
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
      pool: applicationName,
      message: error.message,
      code: "code" in error && typeof error.code === "string" ? error.code : undefined,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    })
  })
  return pool
}

export const db = drizzle({
  client: createDatabasePool("astralbeam-webapp-auth", 5),
  jit: true,
  relations: databaseRelations,
})

const makeEffectDatabase = PgDrizzle.makeWithDefaults({
  relations: databaseRelations,
  jit: true,
})

export type EffectDatabase = Effect.Success<typeof makeEffectDatabase>

export const effectDatabase = Context.Service<EffectDatabase>("@astralbeam/EffectDatabase")

export const runDatabaseEffect = ManagedRuntime.make(
  Layer.effect(effectDatabase, makeEffectDatabase).pipe(
    Layer.provide(
      PgClient.layerFrom(
        PgClient.fromPool({
          acquire: Effect.succeed(createDatabasePool("astralbeam-webapp", 10)),
        }),
      ),
    ),
  ),
).runPromise
