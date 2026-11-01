# Operations

Maintain a running deployment with migrations, coordinated backups, health checks, and logs. For installation, follow [Deploy](./deploy.md).

Database commands need `DATABASE_URL`. The binary also reads [environment files](./deploy.md#3-set-the-bootstrap-environment) from its working directory. Run `bun run` commands from a checkout of the deployed version.

## Applying migrations

Application migrations ship with each release. When migrations are pending, pages redirect to `/configure`.

1. Back up the database and bucket before upgrading a populated deployment.
2. Open **Database migrations** at `/configure` and review the pending SQL and any TypeScript steps.
3. Apply the reviewed set. Other replicas refresh migration state within five seconds of their next read.

Effect manages the separate `effect_cluster_*` tables automatically at runner startup, as described under [cluster readiness and recovery](#cluster-readiness-and-recovery).

Migrations are serialized and each runs in a transaction. If another operator is applying migrations, wait and reload. If the pending set changes, review it again before applying.

On failure, earlier migrations remain applied, the failed migration rolls back, and later ones do not run. Fix the reported cause and retry. Migration state refreshes after CLI migrations and history repairs too.

**NOTE**: Failed transactions roll back automatically. There is no command to undo a committed migration. Reverse an applied change with a new forward migration.

## Database commands

Use the application runner so both SQL and TypeScript migration steps execute:

```sh
astralbeam-platform migrate --dry-run
astralbeam-platform migrate
```

From a checkout of the deployed version:

```sh
bun run --cwd platform db migrate
```

**NOTE**: Do not invoke `drizzle-kit migrate` directly: it skips TypeScript steps while recording the SQL as applied. Never use `drizzle-kit push` against this schema. Contributor migration commands are documented in the [database guide](https://github.com/AstralBeamAI/astralbeam/blob/main/platform/src/db/README.md).

## Backups and restore

Because file state spans PostgreSQL and the configured filesystem directory or S3 bucket, stop all application replicas before backing up the database and files.

Run this command to take that dump:

```sh
pg_dump --format=custom --file=astralbeam.dump "$DATABASE_URL"
```

Keep the replicas stopped. For File System, back up the entire configured directory, preserving relative paths and private permissions, and record its absolute path from **File storage**. For S3, use the provider's backup or export tool to copy the bucket's objects with their original keys and metadata. Record the endpoint, region, bucket name, and addressing mode alongside the backup.

Restoring encrypted settings and credentials requires the matching `DATABASE_ENCRYPTION_KEY`. Use the same PostgreSQL major version or newer, with `citext` available. See [Security](./security.md).

**NOTE**: Back the keyring up in your secret manager, separately from the dump, and never in the same place.

Run this command against an empty database to restore:

```sh
pg_restore --dbname="$DATABASE_URL" astralbeam.dump
```

Restore files to the directory or bucket recorded in the restored configuration, keeping their relative paths or object keys unchanged. If you use a different destination, update **File storage** at `/configure` and restart every server instance. Saving settings does not copy objects.

Then start the application with that `DATABASE_URL` and the encryption keyring that was in effect when the dump was taken. If the restored data predates the running version, the setup gate closes until you approve the missing migrations. Test a restore before you need one, and confirm afterwards that `/configure` can read the stored secrets rather than reporting them unreadable.

## Health checks

| Endpoint | Behavior |
| --- | --- |
| `/api/status` | `200` with `{"status":"ok"}` when the database query succeeds, otherwise `503` |
| `/api/v1/*` | `503` with `Retry-After: 10` and a problem document whose detail is `Server configuration required.` while setup is incomplete |
| `/api/auth/*` | `503` while bootstrap or deployment configuration is incomplete |
| Application pages except `/docs` and `/configure` | Redirect to `/configure` while setup is incomplete |

Point a process supervisor or load balancer probe at `/api/status`. It does not check cluster readiness. There is no separate readiness endpoint. For API readiness, probe an API route and treat `503` as not ready and `401` as ready.

## Shutdown

SIGTERM and SIGINT start a single shutdown sequence. The server stops accepting requests and gives active responses, including streams, up to five seconds to finish. It then stops the cluster runner, destroys live chat sandboxes, closes both database pools, and exits. That cleanup has five seconds of its own, and a failure or timeout exits with status 1. Give the process supervisor more than ten seconds before sending SIGKILL.

Long-lived streams can be disconnected. Accepted durable work remains recoverable through PostgreSQL. Reconnect to inspect the result.

## Cluster readiness and recovery

Each process runs one embedded cluster runner using the main application SQL pool. `Cluster runner ready` means the runner acquired its runtime services. `Cluster runner unavailable` means startup or supervision failed. Check database connectivity, the private runner addresses described in [Deploy](./deploy.md#3-set-the-bootstrap-environment), and whether the runtime database role can initialize or upgrade cluster storage.

The supervisor retries with backoff capped at 30 seconds and logs transitions between ready and unavailable. Effect creates missing cluster storage automatically. Initialization or migration failures keep the runner inactive until a retry succeeds. `/configure` remains available for repair when its database dependencies are reachable. After a process crash, another runner can recover persisted work when its shard leases expire. Recovery is not immediate, and external operations can repeat if their activity result was not persisted before the crash.

The `effect_cluster_*` tables are framework-owned journal and coordination storage. Their native Effect constructors own initialization and migrations, independently of the application migration approval flow. Include them in backups and preserve `effect_cluster_migrations` alongside messages and replies. The runtime database role needs database CONNECT, schema USAGE/CREATE, table read/write access, sequence access, and ownership or membership in the owning role to alter cluster tables. Review upstream storage changes and rolling-version compatibility before upgrading Effect because DDL can run as soon as a new replica starts. There is no automatic journal cleanup. Restoring an older backup can replay external operations, so workflow handlers must use stable idempotency keys.

## Logs

Collect stdout and stderr with your init system or container runtime. Application request and Effect logs use ECS JSON in development and production. Startup commands can also print plain text. The application does not manage log files. `LOG_LEVEL` sets the minimum level and defaults to `Info`, for example `LOG_LEVEL=Debug` includes debug entries.

On Docker hosts, [enable log rotation](https://docs.docker.com/engine/logging/configure/) with the `local` logging driver or bounded `json-file` settings so container logs cannot exhaust the disk.

Request entries include method, status, duration, and request ID. Unexpected failures include a client-facing reference ID and a redacted cause. A stream can fail after its HTTP headers have been sent. Pair the reference with the message shown to the user.

| Message | What to check |
| --- | --- |
| `Database pool idle client error` | Pooler, network connectivity, and database restarts. The entry includes pool identity and counts |
| `Migration failed` | The migration and detail shown at `/configure` |
| `Ignoring invalid stored config value` | Replace the named setting at `/configure`. It is treated as unset |
| `Request failed` | Correlate the reference ID, operation, and redacted error cause |

Cluster readiness entries include the advertised private runner address. Configuration failures omit submitted values. See [Observability](./configuration.md#observability) to export request, model, and tool spans and server logs.

## Connection pooling

Point `DATABASE_URL` at PostgreSQL directly or a transaction-pooling pooler. The native Effect client uses unnamed queries with `prepare: false`. With PgBouncer, keep `pool_mode = transaction` and a non-zero `max_prepared_statements` for clients that use named prepared statements, as in the reference setup, which sets it to 200.

Budget up to 15 client connections per replica: 5 for authentication and 10 for the main application. Size PostgreSQL backend connections separately using the pooler's limits. Both pools use a five-second connection timeout, close connections after 30 seconds idle, and recycle them after 30 minutes.

Size the pooler's own limits for the number of replicas you run, and remember that the migration runner holds one connection for the duration of a migration run.

## Rate limits

Counters live in the shared `rate_limit` table, so every replica enforces the same window.

| Bucket | Limit | Scope |
| --- | --- | --- |
| Operator sign-in at `/configure` | 5 per minute | The whole deployment. Cleared by a successful sign-in |
| Chat turns | 20 per 60 seconds | Organization, Tenant, and tenant user combined |
| Chat host-tool continuations and uploads | 200 per 60 seconds each, in separate buckets | Organization, Tenant, and tenant user combined |
| Sign-up, password reset, verification email, and organization invite | 5 per 60 seconds each | The requesting client address |
| Management API with an API key | 100 per 5 minutes | The API key |
| Management API with a chat token | 100 per 5 minutes | The token's identity |

Exceeding a limit returns `429` with a `Retry-After` header. Before the first migration, operator sign-in permits attempts so first boot remains possible. Chat reaches the setup gate first and returns `503` with `Retry-After: 10` while configuration or migrations are incomplete.

**TIP**: The operator bucket counts attempts for the deployment as a whole rather than per client address, so add an ingress-level limit in front of `/configure` if you want per-address throttling during setup.

## Seeding a demo environment

For disposable local environments, follow [Seed sample data](https://github.com/AstralBeamAI/astralbeam/blob/main/platform/src/db/README.md#seed-sample-data). It creates fixed development credentials and bypasses onboarding. Never seed or reset a database holding real data.
