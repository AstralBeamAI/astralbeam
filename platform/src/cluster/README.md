# Embedded Effect cluster

Each platform process runs one private Effect Cluster runner, backed by PostgreSQL and shared by registered durable workflows.

## Architecture

`ClusterWorkflowEngine` implements native Effect workflows through persisted messages and shard ownership. This directory owns infrastructure. Application definitions and registration live in [workflows](../workflows/README.md).

| Module | Responsibility |
| --- | --- |
| [plugin.server.ts](plugin.server.ts) | Starts the runner through Nitro and disposes its scope on reload and application close. |
| [runtime.server.ts](runtime.server.ts) | Serializes process-wide lifecycle transitions, supervises readiness, and retries unavailable storage. |
| [runner.server.ts](runner.server.ts) | Composes Deno HTTP and crypto, SQL storage, sharding, and `ClusterWorkflowEngine`. |
| [registry.server.ts](../workflows/registry.server.ts) | Registers application workflow handler layers. |
| [db/index.ts](../db/index.ts) | Owns the separate pools, shared SQL runtime and shutdown, with module-local Drizzle adapters and the Promise framework bridge. |

On SIGTERM or SIGINT, Nitro drains HTTP responses, then its close hook stops the runner and both database pools. A five-second deadline bounds shutdown, with exit status 1 on timeout or cleanup failure. See [shutdown operations](../routes/docs/-content/self-hosting/operations.md#shutdown) for stream and supervisor implications.

The Nitro plugin starts without waiting for a request and skips builds, prerendering and ordinary unit tests. Process-global state serializes runner replacement on reload. Initialization replaces old signal listeners and deadlines because Nitro invalidation can skip HMR disposal. Vite requests the same cleanup over its HMR channel and awaits acknowledgment before terminating Nitro's development worker. Module reloads retain the database pools, while worker and process shutdown close them.

A separate runner scope keeps startup failures independent of ordinary database operations and `/configure`. The supervisor logs readiness transitions and SQLSTATE when available, without logging raw errors or credentials. Retries use backoff capped at 30 seconds. Readiness means the local engine was acquired, not that every shard is owned or every workflow is progressing. Effect handles lease-health failures and recovery without restarting the engine for shared-pool contention. Lease expiry and peer health checks also determine recovery time. `/api/status` checks application SQL independently.

The private HTTP listener binds before advertising its actual address. Peers use RPC and ping health checks. PostgreSQL journals and shard leases let another runner recover persisted executions after a crash, independently of the submitting process.

## Storage and deployment

Using the app's `DATABASE_URL`, native `SqlMessageStorage` and `SqlRunnerStorage` initialize and migrate storage before runner readiness, independently of `/configure` and application migrations. Application tables retain the reviewed [migration flow](../db/README.md). Never use Drizzle `push`, including `push --explain`.

Effect owns `effect_cluster_messages`, `effect_cluster_replies`, `effect_cluster_runners`, `effect_cluster_locks` and `effect_cluster_migrations`, outside Drizzle declarations, migrations, snapshots and introspection. Their upstream keys and column types are exceptions to application-domain conventions.

The runtime role needs database CONNECT, schema USAGE/CREATE, table read/write and sequence access, plus ownership or owning-role membership for schema upgrades. A DML-only role is insufficient. Storage normally lives in `public`.

Preserve the journal and `effect_cluster_migrations` during upgrades. Keep Effect packages aligned, review upstream storage changes, and back up before deployment. With no application version or bookkeeping gate, a new replica can immediately apply DDL. Assess migration locking and rolling-version compatibility before rollout.

Local processes default to loopback and distinct OS-assigned ports. Multiple machines must advertise individually reachable private addresses through `CLUSTER_RUNNER_HOST`, `CLUSTER_RUNNER_PORT`, and optionally `CLUSTER_RUNNER_LISTEN_HOST`. See the [runtime configuration](../../AGENTS.md#cluster-runtime) and [local setup](../../../SETUP.md). Keep runner listeners on a trusted private network and out of the public reverse proxy.

PgBouncer uses transaction pooling, so the runner sets `shardLockDisableAdvisory: true` and uses SQL row leases. Effect's default shard, lease, and health timings remain unchanged. Recovery depends on persisted messages and lease expiry, not graceful shutdown.

## References

- [SqlMessageStorage](https://effect.website/docs/v4/api/effect/unstable/cluster/SqlMessageStorage/) and [SqlRunnerStorage](https://effect.website/docs/v4/api/effect/unstable/cluster/SqlRunnerStorage/) own storage initialization and migrations.
- [ClusterWorkflowEngine](https://effect.website/docs/v4/api/effect/unstable/cluster/ClusterWorkflowEngine/) connects workflow execution to cluster sharding and message storage.
- [Workflow API references](../workflows/README.md#references) covers definitions, activities, and durable waits.
