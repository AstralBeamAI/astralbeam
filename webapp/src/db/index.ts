import "@tanstack/react-start/server-only"

import * as PgClient from "@effect/sql-pg/PgClient"
import { drizzle } from "drizzle-orm/node-postgres"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

import { getDatabaseUrl } from "@/db/lib/database-credentials.server"
import { databaseRelations } from "@/db/schema.server"

export const db = drizzle({
  connection: {
    connectionString: getDatabaseUrl(),
  },
  jit: true,
  relations: databaseRelations,
})

db.$client.on("error", (error) => {
  const code = "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN"
  console.error("Database pool idle client error", { code })
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
      PgClient.layerFrom(PgClient.fromPool({ acquire: Effect.succeed(db.$client) })),
    ),
  ),
).runPromise
