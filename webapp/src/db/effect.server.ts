import * as PgClient from "@effect/sql-pg/PgClient"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

import { db } from "@/db/index.server"
import { databaseRelations } from "@/db/schema.server"

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
