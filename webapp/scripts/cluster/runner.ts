import process from "node:process"
import * as PgClient from "@effect/sql-pg/PgClient"
import { Effect, Fiber, Layer, Redacted } from "effect"
import { Entity } from "effect/unstable/cluster"
import { SqlClient } from "effect/unstable/sql"
import { Activity } from "effect/unstable/workflow"
import { readClusterConfiguration } from "../../src/cluster/config.server.ts"
import { clusterRunnerLayer } from "../../src/cluster/runtime.server.ts"
import { clusterProbe, clusterRecoveryWorkflow } from "./protocol.ts"

const clusterProbeHandlers = clusterProbe.toLayer(
  Effect.gen(function* () {
    const address = yield* Entity.CurrentAddress
    let value = 0
    return {
      increment: () =>
        Effect.gen(function* () {
          const current = value
          yield* Effect.sleep("20 millis")
          value = current + 1
          return { value, pid: process.pid }
        }).pipe(Effect.withSpan(`probe/${address.entityId}`)),
    }
  }),
)

const clusterRecoveryHandlers = clusterRecoveryWorkflow.toLayer(({ id }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* Activity.make({
      name: "first",
      execute: sql`
        insert into cluster_test_events (id, phase, pid) values (${id}, 'first', ${process.pid})
        on conflict (id, phase) do update set attempts = cluster_test_events.attempts + 1
      `.pipe(Effect.asVoid, Effect.orDie),
    })
    yield* Activity.make({
      name: "wait",
      execute: Effect.gen(function* () {
        yield* sql`
          insert into cluster_test_events (id, phase, pid) values (${id}, 'wait', ${process.pid})
          on conflict (id, phase) do update set pid = excluded.pid, attempts = cluster_test_events.attempts + 1
        `
        while (true) {
          const rows = yield* sql<{ released: boolean }>`
            select released from cluster_test_events where id = ${id} and phase = 'wait'
          `
          if (rows[0]?.released) return
          yield* Effect.sleep("100 millis")
        }
      }).pipe(Effect.orDie),
    })
    return id
  }),
)

const clusterTestRunner = Effect.runFork(
  Layer.launch(
    Layer.mergeAll(clusterProbeHandlers, clusterRecoveryHandlers).pipe(
      Layer.provideMerge(
        clusterRunnerLayer({
          ...readClusterConfiguration(process.env),
          shardingConfig: {
            shardLockExpiration: "6 seconds",
            shardLockRefreshInterval: "1 second",
            runnerHealthCheckInterval: "1 second",
            refreshAssignmentsInterval: "250 millis",
            entityMessagePollInterval: "100 millis",
            entityTerminationTimeout: "1 second",
          },
        }),
      ),
      Layer.provide(
        PgClient.layer({
          url: Redacted.make(process.env.DATABASE_URL!),
          prepare: false,
        }),
      ),
    ),
  ),
)

process.once("SIGTERM", () => {
  void Effect.runPromise(Fiber.interrupt(clusterTestRunner))
})
await Effect.runPromise(Fiber.join(clusterTestRunner).pipe(Effect.ignoreCause))
