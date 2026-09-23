import * as DenoCrypto from "@effect/platform-deno/DenoCrypto"
import { Effect, Layer } from "effect"
import effectPackage from "effect/package.json" with { type: "json" }
import { ShardingConfig, SqlMessageStorage, SqlRunnerStorage } from "effect/unstable/cluster"
import { SqlClient } from "effect/unstable/sql"

// Gate the upstream constructors, which otherwise migrate on startup.
// https://effect.website/docs/v4/api/effect/unstable/cluster/SqlMessageStorage
export const checkClusterStorageVersion = Effect.gen(function* () {
  if (effectPackage.version !== "4.0.0-rc.117") {
    return yield* Effect.fail(
      new Error("Review cluster storage migrations before upgrading Effect."),
    )
  }
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ migration_id: number; name: string }>`
    select migration_id, name from cluster_migrations order by migration_id
  `
  if (
    JSON.stringify(rows.map((row) => [row.migration_id, row.name])) !==
    JSON.stringify([
      [1, "create_tables"],
      [2, "entity_type_size"],
      [3, "pg_messages_rowid_index"],
    ])
  ) {
    return yield* Effect.fail(
      new Error("Unsupported cluster storage version. Apply the application migrations."),
    )
  }
  yield* sql`select 1 from cluster_messages, cluster_replies, cluster_runners, cluster_locks limit 0`
})

export function clusterStorageLayer(config: Partial<ShardingConfig.ShardingConfig["Service"]>) {
  return Layer.unwrap(
    Effect.as(
      checkClusterStorageVersion,
      Layer.mergeAll(SqlMessageStorage.layer, SqlRunnerStorage.layer).pipe(
        Layer.provide([ShardingConfig.layerFromEnv(config), DenoCrypto.layer]),
      ),
    ),
  )
}
