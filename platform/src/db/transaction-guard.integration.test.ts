import { createServer } from "node:http"

import * as PgClient from "@effect/sql-pg/PgClient"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Context, Effect, Exit, Redacted } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { Database, closeDatabase } from "./database.server.ts"
import {
  guardPromiseDatabase,
  guardPromisePool,
  guardSqlTransactions,
} from "./lib/transaction-guard.server.ts"

const transactionIntegrationUrl = process.env.DATABASE_URL
const transactionIntegrationEnabled =
  transactionIntegrationUrl !== "postgres://test:test@127.0.0.1:5432/test"

describe.skipIf(!transactionIntegrationEnabled)("PostgreSQL transaction network guard", () => {
  const namespace = `transaction-guard:${crypto.randomUUID()}`
  const pool = new Pool({
    connectionString: transactionIntegrationUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
  })
  const database = guardPromiseDatabase(drizzle({ client: pool }))
  const server = createServer((_request, response) => {
    requests += 1
    response.end("ok")
  })
  let requests = 0
  let endpoint: string

  beforeAll(async () => {
    const parsed = new URL(transactionIntegrationUrl!)
    if (
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
      !parsed.pathname.endsWith("_test")
    ) {
      throw new Error(
        "Transaction guard tests require a disposable loopback database ending in _test",
      )
    }
    guardPromisePool(pool)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing listener")
    endpoint = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await pool.query("delete from cache_entry where namespace = $1", [namespace])
    await pool.end()
    await closeDatabase()
  })

  test("production Database layer preserves Drizzle, native SQL and nested savepoints", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* Database
        const client = yield* SqlClient.SqlClient
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [owner] =
              yield* client`select pg_backend_pid() as pid, txid_current()::text as xid`
            const [row] = yield* tx.execute(
              sql`select pg_backend_pid() as pid, txid_current()::text as xid`,
              "objects",
            )
            expect(row).toEqual(owner)
            expect(
              yield* client.withoutTransforms()`select pg_backend_pid() as pid, txid_current()::text as xid`,
            ).toEqual([owner])
            yield* client.withoutTransforms().withTransaction(Effect.void)
            yield* tx.transaction((nested) =>
              Effect.gen(function* () {
                const [row] = yield* nested.execute(
                  sql`select pg_backend_pid() as pid, txid_current()::text as xid`,
                  "objects",
                )
                expect(row).toEqual(owner)
              }),
            )
            yield* Effect.exit(tx.transaction(() => Effect.die("failed savepoint")))
            const blocked = yield* Effect.exit(Effect.promise(() => fetch(endpoint)))
            expect(String(blocked)).toContain("fetch is forbidden")
            expect(
              yield* client`select pg_backend_pid() as pid, txid_current()::text as xid`,
            ).toEqual([owner])
          }),
        )
      }).pipe(Effect.provide(Database.layer), Effect.scoped),
    )
  })

  test("native transaction blocks Promise I/O before sending and rolls back real writes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* PgClient.makeClient({
          url: Redacted.make(transactionIntegrationUrl!),
          prepare: false,
        })
        guardSqlTransactions(client)
        const before = requests
        const exit = yield* Effect.exit(
          client.withTransaction(
            Effect.gen(function* () {
              yield* client`insert into cache_entry (namespace, key, value)
                values (${namespace}, 'native', '1')`
              yield* Effect.promise(async () => {
                await Promise.resolve()
                await fetch(endpoint)
              })
            }),
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain("fetch is forbidden")
        expect(
          yield* client`select key from cache_entry where namespace = ${namespace} and key = 'native'`,
        ).toEqual([])
        expect(requests).toBe(before)
        expect(yield* Effect.promise(async () => (await fetch(endpoint)).text())).toBe("ok")
      }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
    )
  })

  test("rejects another native client and removal of the transaction service", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* PgClient.make({
          url: Redacted.make(transactionIntegrationUrl!),
          prepare: false,
        })
        const other = yield* PgClient.make({
          url: Redacted.make(transactionIntegrationUrl!),
          prepare: false,
        })
        guardSqlTransactions(client)
        guardSqlTransactions(other)
        for (const attempt of [
          other`select 1`,
          other.withTransaction(Effect.void),
          Effect.updateContext(client`select 1`, (context: Context.Context<never>) =>
            Context.omit(client.transactionService)(context),
          ),
          client.reserve,
        ]) {
          const exit = yield* Effect.exit(client.withTransaction(attempt))
          expect(Exit.isFailure(exit)).toBe(true)
          expect(String(exit)).toContain("is forbidden")
        }
      }).pipe(Effect.provide(Reactivity.layer), Effect.scoped),
    )
  })

  test("Promise Drizzle preserves nested SQL and rejects I/O after await with rollback", async () => {
    await database.transaction(async (tx) => {
      const owner = await tx.execute(
        sql`select pg_backend_pid() as pid, txid_current()::text as xid`,
      )
      await tx.transaction(async (nested) => {
        expect(
          (await nested.execute(sql`select pg_backend_pid() as pid, txid_current()::text as xid`))
            .rows,
        ).toEqual(owner.rows)
      })
    })
    const before = requests
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(sql`insert into cache_entry (namespace, key, value)
          values (${namespace}, 'promise', '1')`)
        await Promise.resolve()
        await fetch(endpoint)
      }),
    ).rejects.toThrow("fetch is forbidden")
    expect(
      (
        await pool.query("select key from cache_entry where namespace = $1 and key = 'promise'", [
          namespace,
        ])
      ).rows,
    ).toEqual([])
    expect(requests).toBe(before)
    expect(await (await fetch(endpoint)).text()).toBe("ok")
  })

  test("Promise transaction rejects a pool query and a fresh native transaction", async () => {
    await expect(
      database.transaction(async () => {
        await pool.query("select 1")
      }),
    ).rejects.toThrow("SQL pool connection is forbidden")
    await expect(
      database.transaction(async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* SqlClient.SqlClient
            yield* client.withTransaction(Effect.void)
          }).pipe(Effect.provide(Database.layer), Effect.scoped),
        )
      }),
    ).rejects.toThrow("is forbidden")
    await expect(
      database.transaction(async () => {
        await Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* SqlClient.SqlClient
            yield* client`select 1`
          }).pipe(Effect.provide(Database.layer), Effect.scoped),
        )
      }),
    ).rejects.toThrow("SQL on another connection is forbidden")
  })

  test("rejects an already-connected pg client from an Effect transaction", async () => {
    const other = await pool.connect()
    try {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const db = yield* Database
            yield* db.transaction(() =>
              Effect.promise(async () => {
                await Promise.resolve()
                await other.query("select 1")
              }),
            )
          }).pipe(Effect.provide(Database.layer), Effect.scoped),
        ),
      ).rejects.toThrow("SQL on another connection is forbidden")
    } finally {
      other.release()
    }
  })
})
