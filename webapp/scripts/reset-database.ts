import { layer, PgClient } from "@effect/sql-pg/PgClient"
import { Effect, Redacted } from "effect"

import { databaseUrl } from "../drizzle.config.ts"

const url = new URL(databaseUrl!)
const database = url.pathname.slice(1)
url.pathname = "/postgres"

await Effect.runPromise(
  Effect.gen(function* () {
    const sql = yield* PgClient
    yield* sql`DROP DATABASE IF EXISTS ${sql(database)} WITH (FORCE)`
    yield* sql`CREATE DATABASE ${sql(database)}`
  }).pipe(
    Effect.provide(layer({ url: Redacted.make(url.href) })),
  ),
)
