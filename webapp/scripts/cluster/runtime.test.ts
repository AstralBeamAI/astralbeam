import { type ChildProcess, spawn } from "node:child_process"
import process from "node:process"
import { createConnection, createServer, type Socket } from "node:net"
import * as PgClient from "@effect/sql-pg/PgClient"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { Pool } from "pg"
import { SqlClient } from "effect/unstable/sql"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { clusterClientLayer, clusterRunnerLayer } from "../../src/cluster/runtime.server.ts"
import { checkClusterStorageVersion } from "../../src/cluster/storage.server.ts"
import { clusterProbe, clusterRecoveryWorkflow } from "./protocol.ts"
import { exampleWorkflow } from "../../src/workflows/example.server.ts"

describe.skipIf(process.env.CLUSTER_INTEGRATION !== "1")("PostgreSQL cluster processes", () => {
  const url = process.env.DATABASE_URL!
  const parsed = new URL(url)
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Cluster tests require a local database")
  }
  const pool = new Pool({ connectionString: url })
  const client = ManagedRuntime.make(
    clusterClientLayer.pipe(
      Layer.provideMerge(
        PgClient.layer({
          url: Redacted.make(url),
          prepare: false,
        }),
      ),
    ),
  )
  const runners: ChildProcess[] = []
  const ids: string[] = []

  async function startClusterTestRunner(databaseUrl = url) {
    const reservation = createServer()
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve))
    const address = reservation.address()
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener")
    const port = address.port
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    )
    const child = spawn(process.execPath, ["run", "-A", "scripts/cluster/runner.ts"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, CLUSTER_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    runners.push(child)
    let output = ""
    child.stdout.on("data", (data) => {
      output += String(data)
    })
    child.stderr.on("data", (data) => {
      output += String(data)
    })
    await expect
      .poll(
        () => {
          if (child.exitCode !== null) throw new Error(output)
          return output.match(/Cluster runner listening at 127\.0\.0\.1:(\d+)/)?.[1]
        },
        { timeout: 20_000 },
      )
      .toBeDefined()
    return {
      child,
      port: Number(output.match(/Cluster runner listening at 127\.0\.0\.1:(\d+)/)![1]),
    }
  }

  async function stopClusterTestRunner(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    child.kill(signal)
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
          reject(new Error("Runner shutdown timed out"))
        }, 10_000)
        void exited.finally(() => clearTimeout(timer))
      }),
    ])
  }

  beforeAll(async () => {
    await pool.query(`create table if not exists cluster_test_events (
      id text not null, phase text not null, pid integer not null,
      attempts integer not null default 1, released boolean not null default false,
      primary key (id, phase)
    )`)
  })

  afterEach(async () => {
    await Promise.all(runners.splice(0).map((child) => stopClusterTestRunner(child)))
  })

  afterAll(async () => {
    await client.dispose()
    await pool.query("delete from cluster_test_events where id = any($1)", [ids])
    await pool.end()
  })

  test("routes and deduplicates commands with one, two and three runners", async () => {
    const ports = new Set<number>()
    for (let count = 1; count <= 3; count++) {
      ports.add((await startClusterTestRunner()).port)
      const organization = crypto.randomUUID()
      const results = await client.runPromise(
        Effect.gen(function* () {
          const entityClient = yield* clusterProbe.client
          return yield* Effect.all(
            Array.from({ length: 8 }, (_, index) =>
              entityClient(`${organization}/conversation`).increment({ id: String(index) }),
            ),
            { concurrency: "unbounded" },
          )
        }).pipe(Effect.timeout("30 seconds")),
      )
      expect(results.map((r) => r.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      const duplicates = await client.runPromise(
        Effect.gen(function* () {
          const entityClient = yield* clusterProbe.client
          const original = yield* entityClient(`${organization}/conversation`).increment({
            id: "0",
          })
          const other = yield* entityClient(`${crypto.randomUUID()}/conversation`).increment({
            id: "0",
          })
          return { original, other }
        }),
      )
      expect(duplicates.original).toEqual(results[0])
      expect(duplicates.other.value).toBe(1)
    }
    expect(ports.size).toBe(3)
    await expect
      .poll(
        async () =>
          (
            await pool.query<{ count: number }>(
              "select count(distinct address)::integer as count from cluster_locks where address = any($1)",
              [[...ports].map((port) => `127.0.0.1:${port}`)],
            )
          ).rows[0]?.count,
        { timeout: 10_000 },
      )
      .toBe(3)
    const owners = await client.runPromise(
      Effect.gen(function* () {
        const entityClient = yield* clusterProbe.client
        return yield* Effect.all(
          Array.from({ length: 40 }, () =>
            entityClient(crypto.randomUUID()).increment({ id: "distribution" }),
          ),
          { concurrency: 8 },
        )
      }),
    )
    expect(new Set(owners.map((owner) => owner.pid)).size).toBe(3)
  }, 120_000)

  test("refuses unsupported or missing storage without recreating tables", async () => {
    const databaseLayer = PgClient.layer({ url: Redacted.make(url), prepare: false })
    for (const mutation of [
      "update cluster_migrations set name = 'unsupported' where migration_id = 3",
      "alter table cluster_messages rename to cluster_test_hidden_messages",
    ]) {
      const attempt = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql.unsafe(mutation)
            yield* checkClusterStorageVersion
          }),
        )
      }).pipe(Effect.provide(databaseLayer))
      await expect(Effect.runPromise(attempt)).rejects.toThrow()
    }
    expect(
      (
        await pool.query<{ name: string }>(
          "select name from cluster_migrations where migration_id = 3",
        )
      ).rows[0]?.name,
    ).toBe("pg_messages_rowid_index")
    expect(
      (await pool.query<{ name: string }>("select to_regclass('cluster_messages') as name")).rows[0]
        ?.name,
    ).toBe("cluster_messages")
  })

  test("an explicitly occupied port fails instead of moving to another port", async () => {
    const { port } = await startClusterTestRunner()
    await expect(
      Effect.runPromise(
        Layer.launch(
          clusterRunnerLayer({
            host: "127.0.0.1",
            listenHost: "127.0.0.1",
            port,
          }),
        ).pipe(
          Effect.provide(PgClient.layer({ url: Redacted.make(url), prepare: false })),
          Effect.timeout("5 seconds"),
        ),
      ),
    ).rejects.toThrow(/address|listen|ServeError/i)
  })

  test("workflow acceptance commits and rolls back with business writes", async () => {
    const key = crypto.randomUUID()
    ids.push(key)
    const executionId = await Effect.runPromise(exampleWorkflow.executionId({ key }))
    const submit = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`insert into cluster_test_events (id, phase, pid) values (${key}, 'transaction', ${process.pid})`
      return yield* exampleWorkflow.execute({ key }, { discard: true })
    })
    const rollback = await client.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(submit.pipe(Effect.andThen(Effect.fail("rollback"))))
        }),
      ),
    )
    expect(rollback).toMatchObject({ _tag: "Failure", failure: "rollback" })
    expect(
      (await pool.query("select id from cluster_test_events where id = $1", [key])).rows,
    ).toEqual([])
    expect(
      (await pool.query("select id from cluster_messages where entity_id = $1", [executionId]))
        .rows,
    ).toEqual([])

    expect(
      await client.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(submit)
        }),
      ),
    ).toBe(executionId)
    expect(
      (await pool.query("select id from cluster_test_events where id = $1", [key])).rows,
    ).toHaveLength(1)
    expect(
      (await pool.query("select id from cluster_messages where entity_id = $1", [executionId]))
        .rows,
    ).toHaveLength(1)
  })

  test("recovers a killed owner and a complete restart without replaying completed activities", async () => {
    await startClusterTestRunner()
    await startClusterTestRunner()
    const id = crypto.randomUUID()
    ids.push(id)
    await client.runPromise(clusterRecoveryWorkflow.execute({ id }, { discard: true }))
    let owner = 0
    await expect
      .poll(
        async () => {
          const result = await pool.query<{ pid: number }>(
            "select pid from cluster_test_events where id = $1 and phase = 'wait'",
            [id],
          )
          owner = result.rows[0]?.pid ?? 0
          return owner
        },
        { timeout: 30_000 },
      )
      .not.toBe(0)
    await stopClusterTestRunner(
      runners.find((child) => child.pid === owner)!,
      "SIGKILL",
    )
    await expect
      .poll(
        async () => {
          const result = await pool.query<{ pid: number }>(
            "select pid from cluster_test_events where id = $1 and phase = 'wait'",
            [id],
          )
          return result.rows[0]?.pid
        },
        { timeout: 30_000 },
      )
      .not.toBe(owner)
    await Promise.all(runners.map((child) => stopClusterTestRunner(child)))
    await startClusterTestRunner()
    await pool.query("update cluster_test_events set released = true where id = $1", [id])
    expect(
      await client.runPromise(
        clusterRecoveryWorkflow.execute({ id }).pipe(Effect.timeout("30 seconds")),
      ),
    ).toBe(id)
    const result = await pool.query<{ attempts: number }>(
      "select attempts from cluster_test_events where id = $1 and phase = 'first'",
      [id],
    )
    expect(result.rows[0]?.attempts).toBe(1)
  }, 120_000)
  test("hands work off during a runner database outage and reconnects", async () => {
    await Promise.all(runners.map((child) => stopClusterTestRunner(child)))
    let connected = true
    const sockets = new Set<Socket>()
    const proxy = createServer((socket) => {
      if (!connected) {
        socket.destroy()
        return
      }
      const upstream = createConnection({
        host: parsed.hostname,
        port: Number(parsed.port || 5432),
      })
      for (const connection of [socket, upstream]) {
        sockets.add(connection)
        connection.on("error", () => {
          socket.destroy()
          upstream.destroy()
        })
        connection.on("close", () => {
          sockets.delete(connection)
        })
      }
      socket.pipe(upstream).pipe(socket)
    })
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
    try {
      const address = proxy.address()
      if (!address || typeof address === "string") throw new Error("Expected a TCP proxy")
      const proxyUrl = new URL(url)
      proxyUrl.port = String(address.port)
      const isolated = await startClusterTestRunner(proxyUrl.href)
      const id = crypto.randomUUID()
      ids.push(id)
      await client.runPromise(clusterRecoveryWorkflow.execute({ id }, { discard: true }))
      await expect
        .poll(
          async () =>
            (
              await pool.query<{ pid: number }>(
                "select pid from cluster_test_events where id = $1 and phase = 'wait'",
                [id],
              )
            ).rows[0]?.pid,
          { timeout: 30_000 },
        )
        .toBe(isolated.child.pid)
      connected = false
      for (const socket of sockets) socket.destroy()
      await startClusterTestRunner()
      await expect
        .poll(
          async () =>
            (
              await pool.query<{ pid: number }>(
                "select pid from cluster_test_events where id = $1 and phase = 'wait'",
                [id],
              )
            ).rows[0]?.pid,
          { timeout: 30_000 },
        )
        .not.toBe(isolated.child.pid)
      connected = true
      await pool.query("update cluster_test_events set released = true where id = $1", [id])
      expect(
        await client.runPromise(
          clusterRecoveryWorkflow.execute({ id }).pipe(Effect.timeout("30 seconds")),
        ),
      ).toBe(id)
      expect(
        (
          await pool.query<{ attempts: number }>(
            "select attempts from cluster_test_events where id = $1 and phase = 'first'",
            [id],
          )
        ).rows[0]?.attempts,
      ).toBe(1)
      await expect
        .poll(
          async () =>
            (
              await pool.query<{ count: number }>(
                "select count(*)::integer as count from cluster_locks where address = $1 and acquired_at > now() - interval '3 seconds'",
                [`127.0.0.1:${isolated.port}`],
              )
            ).rows[0]?.count,
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0)
    } finally {
      connected = true
      await Promise.all(runners.map((child) => stopClusterTestRunner(child)))
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  }, 120_000)
})
