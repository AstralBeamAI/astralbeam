import http, { createServer } from "node:http"
import { createHash } from "node:crypto"
import type { Socket } from "node:net"

import { Context, Effect, Fiber } from "effect"
import type { SqlClient, SqlConnection } from "effect/sql"
import { Pool } from "pg"
import { afterAll, beforeAll, expect, test } from "vitest"

import { guardPromisePool, withGuardedSqlTransaction } from "./transaction-guard.server.ts"

const guardTestConnection = {} as SqlConnection.Connection
const guardTestService = Context.Service<
  SqlClient.TransactionConnection,
  SqlClient.TransactionConnection.Service
>("test/TransactionConnection")
const guardTestSql = {
  transactionService: guardTestService,
  withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, guardTestService, [guardTestConnection, 0]),
}
const guardTestPool = new Pool()
const guardTestServer = createServer((_request, response) => {
  guardTestRequests += 1
  response.end("ok")
})
let guardTestRequests = 0
let guardTestUrl: string

beforeAll(async () => {
  guardPromisePool(guardTestPool)
  await new Promise<void>((resolve) => guardTestServer.listen(0, "127.0.0.1", resolve))
  const address = guardTestServer.address()
  if (!address || typeof address === "string") throw new Error("Missing HTTP listener")
  guardTestUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  guardTestServer.closeAllConnections()
  await new Promise<void>((resolve) => guardTestServer.close(() => resolve()))
  await guardTestPool.end()
})

test("child fibers retain the guard after native await", async () => {
  const requests = guardTestRequests
  await expect(
    Effect.runPromise(
      withGuardedSqlTransaction(
        guardTestSql,
        Effect.gen(function* () {
          const child = yield* Effect.forkChild(
            Effect.promise(async () => {
              await new Promise<void>((resolve) => setTimeout(resolve, 1))
              return fetch(guardTestUrl)
            }),
          )
          return yield* Fiber.join(child)
        }),
      ),
    ),
  ).rejects.toThrow("fetch is forbidden")
  expect(guardTestRequests).toBe(requests)
})

test("blocks writes to an HTTP request constructed before the transaction", async () => {
  const requests = guardTestRequests
  const request = http.request(guardTestUrl, { method: "POST" })
  request.on("error", () => {})
  try {
    await Effect.runPromise(
      withGuardedSqlTransaction(
        guardTestSql,
        Effect.sync(() => {
          expect(() => request.write("body")).toThrow("HTTP request write is forbidden")
          expect(() => request.end()).toThrow("HTTP request end is forbidden")
          expect(() => request.flushHeaders()).toThrow("HTTP request flushHeaders is forbidden")
        }),
      ),
    )
    expect(guardTestRequests).toBe(requests)
  } finally {
    request.destroy()
  }
})

test("blocks sends through an already-open WebSocket", async () => {
  let connection: Socket | undefined
  let received = 0
  const server = createServer()
  server.on("upgrade", (request, socket) => {
    connection = socket as Socket
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64")
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    socket.on("data", (data: Buffer) => {
      received += data.length
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing WebSocket listener")
  const websocket = new WebSocket(`ws://127.0.0.1:${address.port}`)
  try {
    await new Promise<void>((resolve, reject) => {
      websocket.onopen = () => resolve()
      websocket.onerror = () => reject(new Error("WebSocket handshake failed"))
    })
    await Effect.runPromise(
      withGuardedSqlTransaction(
        guardTestSql,
        Effect.sync(() => {
          expect(() => websocket.send("forbidden")).toThrow("WebSocket.send is forbidden")
          expect(() => websocket.close()).toThrow("WebSocket.close is forbidden")
        }),
      ),
    )
    expect(received).toBe(0)
  } finally {
    websocket.close()
    connection?.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
