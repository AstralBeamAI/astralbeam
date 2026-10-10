import { AsyncLocalStorage } from "node:async_hooks"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import tls from "node:tls"

import type * as PgClient from "@effect/sql-pg/PgClient"
import { Context, Effect, Fiber, Option, Schema, Tracer } from "effect"
import { Statement } from "effect/sql"
import type { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { Client } from "pg"
import type { Pool, PoolClient } from "pg"

class TransactionNetworkError extends Schema.TaggedError<TransactionNetworkError>()(
  "TransactionNetworkError",
  { operation: Schema.String },
) {
  override get message() {
    return `${this.operation} is forbidden inside a database transaction`
  }
}

interface TransactionOwner {
  kind: "effect" | "promise"
  connection: unknown
  active: boolean
}

const transactionOwner = Context.Reference<TransactionOwner | undefined>(
  "platform/TransactionOwner",
  { defaultValue: () => undefined },
)

const transactionContextKey = Symbol.for("platform.transactionContext")
const transactionProcess = globalThis as typeof globalThis & {
  [transactionContextKey]?: AsyncLocalStorage<
    | {
        fiber?: Fiber.Fiber<unknown, unknown>
        owner?: TransactionOwner
      }
    | undefined
  >
}
const transactionAsyncContext = (transactionProcess[transactionContextKey] ??=
  new AsyncLocalStorage())

function currentTransactionOwner() {
  const inherited = transactionAsyncContext.getStore()
  const current = Fiber.getCurrent()
  // A resumed sibling can inherit another fiber's native async context. Its own reference wins.
  if (current) return current.getRef(transactionOwner) ?? inherited?.owner
  return inherited?.fiber?.getRef(transactionOwner) ?? inherited?.owner
}

export function isInDatabaseTransaction(kind?: TransactionOwner["kind"]): boolean {
  const owner = currentTransactionOwner()
  return owner !== undefined && (kind === undefined || owner.kind === kind)
}

function assertTransactionNetworkAllowed(operation: string): void {
  if (isInDatabaseTransaction()) throw new TransactionNetworkError({ operation })
}

export function assertTransactionConnection(connection: unknown): void {
  const owner = currentTransactionOwner()
  if (owner && (!owner.active || owner.connection !== connection)) {
    throw new TransactionNetworkError({ operation: "SQL on another connection" })
  }
}

export function withGuardedSqlTransaction<A, E, R>(
  client: Pick<SqlClient.SqlClient, "withTransaction" | "transactionService">,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const existing = yield* Effect.serviceOption(client.transactionService)
    assertTransactionConnection(Option.isSome(existing) ? existing.value[0] : undefined)
    return yield* client.withTransaction(
      Effect.withFiber<A, E, R>((fiber) => {
        const [connection] = Context.getUnsafe(fiber.context, client.transactionService)
        const owner: TransactionOwner = { connection, active: true, kind: "effect" }
        const tracer = fiber.getRef(Tracer.Tracer)
        // The public tracer hook bridges each primitive into native Promise async context.
        // https://effect.website/docs/v4/api/effect/Tracer/#effectprimitive
        return effect.pipe(
          Effect.provideService(transactionOwner, owner),
          Effect.provideService(Tracer.Tracer, {
            span: (options) => tracer.span(options),
            context: (primitive, current) =>
              transactionAsyncContext.run({ fiber: current }, () =>
                tracer.context
                  ? tracer.context(primitive, current)
                  : primitive["~effect/Effect/evaluate"](current),
              ),
          }),
          Effect.ensuring(
            Effect.sync(() => {
              owner.active = false
            }),
          ),
        )
      }),
    )
  })
}

export function runGuardedPromiseTransaction<A>(connection: unknown, execute: () => Promise<A>) {
  assertTransactionNetworkAllowed("Starting another database transaction")
  const owner: TransactionOwner = { connection, active: true, kind: "promise" }
  return transactionAsyncContext.run({ owner }, () =>
    execute().finally(() => {
      owner.active = false
    }),
  )
}

const transactionGuardsKey = Symbol.for("platform.transactionGuards")
const guardedProcess = globalThis as typeof globalThis & {
  [transactionGuardsKey]?: { installed: boolean; clients: WeakSet<object> }
}
const transactionGuards = (guardedProcess[transactionGuardsKey] ??= {
  installed: false,
  clients: new WeakSet<object>(),
})

function guardedTransactionTransport<F extends (...args: never[]) => unknown>(
  transport: F,
  operation: string,
): F {
  return new Proxy(transport, {
    apply(target, receiver, args) {
      assertTransactionNetworkAllowed(operation)
      return Reflect.apply(target, receiver, args) as ReturnType<F>
    },
  })
}

/** Check before driver submission, so a rejected pg query never enters its queue. */
function installTransactionTransportGuards() {
  // Separate server bundles may inline distinct pg classes, so guard each query prototype.
  if (!transactionGuards.clients.has(Client.prototype)) {
    transactionGuards.clients.add(Client.prototype)
    Client.prototype.query = new Proxy(Reflect.get(Client.prototype, "query"), {
      apply(target, receiver, args) {
        assertTransactionConnection(receiver)
        return Reflect.apply(target, receiver, args) as unknown
      },
    })
  }
  if (transactionGuards.installed) return
  transactionGuards.installed = true
  globalThis.fetch = guardedTransactionTransport(globalThis.fetch, "fetch")
  for (const [transport, prefix] of [
    [http, "http"],
    [https, "https"],
  ] as const) {
    for (const method of ["request", "get"] as const) {
      Object.assign(transport, {
        [method]: guardedTransactionTransport(transport[method], `${prefix}.${method}`),
      })
    }
  }
  for (const method of ["write", "end", "flushHeaders"] as const) {
    Object.assign(http.ClientRequest.prototype, {
      [method]: guardedTransactionTransport(
        Reflect.get(http.ClientRequest.prototype, method),
        `HTTP request ${method}`,
      ),
    })
  }
  net.Socket.prototype.connect = guardedTransactionTransport(
    Reflect.get(net.Socket.prototype, "connect"),
    "TCP connect",
  )
  tls.connect = guardedTransactionTransport(tls.connect, "TLS connect")
  globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
    construct(target, args, constructor) {
      assertTransactionNetworkAllowed("WebSocket")
      return Reflect.construct(target, args, constructor) as WebSocket
    },
  })
  for (const method of ["send", "close"] as const) {
    Object.assign(globalThis.WebSocket.prototype, {
      [method]: guardedTransactionTransport(
        Reflect.get(globalThis.WebSocket.prototype, method),
        `WebSocket.${method}`,
      ),
    })
  }
  const denoTransport = Reflect.get(globalThis, "Deno") as
    | Record<"connect" | "connectTls", (...args: unknown[]) => unknown>
    | undefined
  if (denoTransport) {
    for (const method of ["connect", "connectTls"] as const) {
      denoTransport[method] = guardedTransactionTransport(denoTransport[method], `Deno.${method}`)
    }
  }
}

export function guardSqlTransactions(client: PgClient.PgClient): void {
  installTransactionTransportGuards()
  if (transactionGuards.clients.has(client)) return
  transactionGuards.clients.add(client)
  const original = {
    transactionService: client.transactionService,
    withTransaction: client.withTransaction,
  }
  const { reserve, notify, listen } = client
  const untransformed = client.withoutTransforms()
  transactionGuards.clients.add(untransformed)
  const guards = {
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.withFiber<A, E | SqlError, R>((fiber) => {
        const previous = fiber.getRef(Statement.CurrentTransformer)
        const guard = transactionStatementGuard(client)
        const transformer: Statement.Transformer = (statement, constructor, current, span) =>
          Effect.flatMap(guard(statement, constructor, current, span), (checked) =>
            previous ? previous(checked, constructor, current, span) : Effect.succeed(checked),
          )
        return withGuardedSqlTransaction(
          original,
          Effect.provideService(effect, Statement.CurrentTransformer, transformer),
        )
      }),
    reserve: Effect.andThen(
      Effect.sync(() => assertTransactionNetworkAllowed("SQL reserve")),
      reserve,
    ),
    notify: (...args: Parameters<typeof notify>) =>
      Effect.andThen(
        Effect.sync(() => assertTransactionNetworkAllowed("SQL notify")),
        notify(...args),
      ),
    listen: (...args: Parameters<typeof listen>) =>
      Effect.andThen(
        Effect.sync(() => assertTransactionNetworkAllowed("SQL listen")),
        listen(...args),
      ),
    withoutTransforms: () => untransformed,
  }
  Object.assign(client, guards)
  if (untransformed !== client) Object.assign(untransformed, guards)
}

export function transactionStatementGuard(client: PgClient.PgClient): Statement.Transformer {
  const untransformed = client.withoutTransforms()
  return (statement, constructor, current) =>
    Effect.sync(() => {
      if (constructor !== client && constructor !== untransformed) {
        assertTransactionNetworkAllowed("SQL on another client")
      }
      const connection = Context.getOption(current.context, client.transactionService)
      assertTransactionConnection(Option.isSome(connection) ? connection.value[0] : undefined)
      return statement
    })
}

export function guardPromisePool(pool: Pool): void {
  installTransactionTransportGuards()
  pool.connect = new Proxy(Reflect.get(pool, "connect"), {
    apply(target, receiver, args) {
      if (args.length > 0) {
        assertTransactionNetworkAllowed("SQL pool connection")
        return Reflect.apply(target, receiver, args) as unknown
      }
      const acquire = () => Reflect.apply(target, receiver, args) as Promise<PoolClient>
      const owner = currentTransactionOwner()
      if (!owner) return acquire()
      assertTransactionConnection(pool)
      return transactionAsyncContext.run(undefined, acquire).then((connection) => {
        owner.connection = connection
        return connection
      })
    },
  })
}

export function guardPromiseDatabase<
  T extends { $client: Pool; transaction: (...args: never[]) => Promise<unknown> },
>(database: T): T {
  database.transaction = new Proxy(database.transaction, {
    apply(target, receiver, args) {
      return runGuardedPromiseTransaction(
        database.$client,
        () => Reflect.apply(target, receiver, args) as Promise<unknown>,
      )
    },
  })
  return database
}
