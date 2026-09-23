# Effect cluster

Each webapp process hosts a runner. One process owns all assigned shards, and additional processes share them automatically. Callers address an entity by type and ID, independent of the runner that currently owns it. PostgreSQL stores ownership leases, persisted messages, replies, and workflow checkpoints. Peers communicate over private HTTP with NDJSON encoding.

Register native workflow definitions and handler layers in `../workflows/registry.server.ts`. This is the single handler registration point, using `Layer.mergeAll`. Those handlers receive the shared SQL client, sharding, and `ClusterWorkflowEngine`. The database runtime remains shared with application Effects, while Better Auth retains its independent pool.

`clusterRunnerLayer` uses the upstream `DenoClusterHttp.layer` with a configured listener and advertised address. `clusterClientLayer` provides the same entity and workflow clients without hosting shards. Compose the client layer once in a caller's long-lived scope with the existing database services, rather than constructing a layer for every request or adding another SQL pool. Both layers check storage compatibility before upstream storage constructors run.

## Deployment

Default startup needs only the existing database configuration and approved migrations. The listener binds loopback on the webapp port minus one, defaulting to 4499 in development and 2999 in production. Production follows `NITRO_PORT`, then `PORT`, while development follows Vite's `PORT`. Multiple processes on one machine need distinct port pairs or explicit `CLUSTER_PORT` values. Set `CLUSTER_PORT` when using Vite's `--port` option or an ephemeral webapp port.

| Environment override  | Default     | Purpose                              |
| --------------------- | ----------- | ------------------------------------ |
| `CLUSTER_HOST`        | `127.0.0.1` | Address advertised to other runners  |
| `CLUSTER_LISTEN_HOST` | `127.0.0.1` | Local bind address                   |
| `CLUSTER_PORT`        | `34431`     | Explicit runner port from 1 to 65535 |
| `CLUSTER_ENABLED`     | Enabled     | Set to `false` to disable hosting    |

Across machines, set the advertised host to each process's reachable private hostname or IP, bind to the appropriate interface, and allow the configured port between peers. Use equal shard configuration and the same database across all replicas. A shared load balancer cannot identify individual runners. The cluster endpoint is an infrastructure protocol without application authentication and must remain on a trusted private network.

Missing migrations or temporary startup failures keep hosting unavailable and retry every ten seconds. `/configure` remains available. An invalid configuration is logged and requires a restart after correction. Startup logs the configured advertised address. During shutdown, cluster scopes stop before database disposal, and outstanding web requests retain database access until HTTP drains.

## Durability

Use `ClusterSchema.Persisted` on entity RPCs that must survive restarts, with stable request primary keys for deduplication. In-memory entity state is not durable. Store business state explicitly and include organization and tenant UUIDs in entity identities. Entity identity does not replace authorization or scoped database queries.

Use named workflow activities for completed-step replay, durable clocks for waits, and durable deferred values for approvals. A crash can repeat an external side effect before its result is recorded, so use provider idempotency keys or database constraints. A single serialized entity remains one unit of work even when more processes join.

The `cluster_*` tables follow Effect's infrastructure schema. Workflows have no additional metadata tables or KV records. Review the storage schema and version guard together whenever upgrading Effect. This foundation includes a synthetic single-activity workflow and no business-specific workflows or automatic journal retention policy.

See [Entity](https://effect.website/docs/v4/api/effect/unstable/cluster/Entity), [ClusterWorkflowEngine](https://effect.website/docs/v4/api/effect/unstable/cluster/ClusterWorkflowEngine), and [SqlRunnerStorage](https://effect.website/docs/v4/api/effect/unstable/cluster/SqlRunnerStorage) for the upstream contracts.

## Verification

See [local setup](../../../SETUP.md#option-2-run-directly-on-macos) for the opt-in process-suite command.

It starts real Deno runners and checks routing, serialization per entity, scoped identities, deduplication, explicit-port conflicts, storage guards, transaction rollback, crash recovery, full restart, and database disconnection through a local TCP proxy. Its synthetic events use a dedicated test table. Ordinary test runs skip the database scenarios and retain the shutdown regression.
