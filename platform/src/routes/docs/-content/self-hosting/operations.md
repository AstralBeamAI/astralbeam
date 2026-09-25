# Operations

A running deployment needs migrations applied, backups taken, and a handful of limits and log lines understood. [Deploy](./deploy.md) covers the install itself.

Every command below runs from the repository root, from a checkout of the deployed version, and needs `DATABASE_URL` in the environment.

## Applying migrations

Application migrations ship inside the artifact. When a release adds one, the setup gate closes on every replica, pages redirect to `/configure`, and the page shows a **Database migrations** card with the pending count, how many are already applied, and each migration's full SQL behind a disclosure. Read the SQL, back up the database if it holds data you cannot lose, then apply.

Effect manages the separate `effect_cluster_*` tables automatically at runner startup, as described under [cluster readiness and recovery](#cluster-readiness-and-recovery).

Three things happen when you apply application migrations.

- The run takes a PostgreSQL advisory lock, so only one migration run happens at a time across all replicas. A second attempt returns `A migration run is already in progress`.
- The page approves the exact set it showed you, by name and SQL digest. If the pending set changed in between, the run is refused with `The pending migrations changed; review them again`, and you review the new list.
- Each migration runs in its own transaction and is recorded before the next one starts.

A failure stops the run and reports `Migration '<name>' failed: <code>: <message>`. The migrations before it stay applied and recorded, the failed one is rolled back, and nothing after it runs. Fix the cause and apply again from the same page, and the already-applied migrations are not re-run.

**NOTE**: There is no rollback. Reverse an applied change with a new forward migration.

## Database commands

The operator page and the Drizzle CLI write the same bookkeeping table, `drizzle.__drizzle_migrations`, and match applied migrations by name, so the two are interchangeable. Reach for the CLI when you would rather migrate before restarting, or when you have no browser access to `/configure`.

Run this command to apply every checked-in migration that has not run yet:

```sh
deno task --cwd platform db migrate
```

Run this command to validate the consistency of the migration history on disk, which says nothing about the state of the live database:

```sh
deno task --cwd platform db check
```

**NOTE**: Never use Drizzle `push`, including `push --explain`, in any environment or for local prototypes. It compares the schema with a live database instead of applying reviewed migration files.

## Backups and restore

All state is in PostgreSQL, so a logical dump of the one database is a complete backup.

Run this command to take that dump:

```sh
pg_dump --format=custom --file=astralbeam.dump "$DATABASE_URL"
```

Two things make an AstralBeam dump different from an ordinary one. The dump is useless without the matching `DATABASE_ENCRYPTION_KEY`, because deployment settings and sandbox provider credentials are stored as ciphertext keyed from it, as described in [Security](./security.md). Restoring also needs a server at the same PostgreSQL major version or newer, with the `citext` extension available.

**NOTE**: Back the keyring up in your secret manager, separately from the dump, and never in the same place.

Run this command against an empty database to restore:

```sh
pg_restore --dbname="$DATABASE_URL" astralbeam.dump
```

Then start the application with that `DATABASE_URL` and the encryption keyring that was in effect when the dump was taken. If the restored data predates the running version, the setup gate closes until you approve the missing migrations. Test a restore before you need one, and confirm afterwards that `/configure` can read the stored secrets rather than reporting them unreadable.

## Health checks

| Endpoint | Behavior |
| --- | --- |
| `/api/status` | Counts organization rows. `200` with `{"status":"ok"}` when that query succeeds, otherwise `503` with an `error` field. It does not read the request |
| `/api/v1/*` | `503` with `Retry-After: 10` and a problem document whose detail is `Server configuration required.` while setup is incomplete |
| `/api/auth/*` | `503` with `{"error":"Application is not configured"}` while setup is incomplete |
| Page routes | Redirect to `/configure` while setup is incomplete |

Point a process supervisor or load balancer probe at `/api/status`. It counts organization rows and reports `{"status":"ok"}` only when that query succeeds, so a database outage returns `503` with an `error` field. This endpoint does not check cluster readiness. There is no separate readiness endpoint. For API readiness, probe an API route and treat `503` as not ready and `401` as ready.

## Shutdown

SIGTERM and SIGINT start a single shutdown sequence. Nitro stops accepting requests and allows active responses, including streams, to finish. It then closes the cluster runner and both database pools. The entire sequence has a five-second deadline. Cleanup failure or timeout exits with status 1. Give the process supervisor more than five seconds before sending SIGKILL.

Long-lived streams can exceed that deadline and be disconnected. Durably accepted workflows remain recoverable through PostgreSQL, but their callers must reconnect to inspect the result. Development reloads close the runner scope while retaining the shared database pools.

## Cluster readiness and recovery

Each process runs one embedded cluster runner using the main application SQL pool. `Cluster runner ready` means the runner acquired its runtime services. `Cluster runner unavailable` means startup or supervision failed. Check database connectivity, the private runner addresses described in [Deploy](./deploy.md#3-set-the-bootstrap-environment), and whether the runtime database role can initialize or upgrade cluster storage.

The supervisor retries with backoff capped at 30 seconds and logs transitions between ready and unavailable. Effect creates missing cluster storage automatically. Initialization or migration failures keep the runner inactive until a retry succeeds. `/configure` remains available for repair when its database dependencies are reachable. After a process crash, another runner can recover persisted work when its shard leases expire. Recovery is not immediate, and external operations can repeat if their activity result was not persisted before the crash.

The `effect_cluster_*` tables are framework-owned journal and coordination storage. Their native Effect constructors own initialization and migrations, independently of the application migration approval flow. Include them in backups and preserve `effect_cluster_migrations` alongside messages and replies. The runtime database role needs database CONNECT, schema USAGE/CREATE, table read/write access, sequence access, and ownership or membership in the owning role to alter cluster tables. Review upstream storage changes and rolling-version compatibility before upgrading Effect because DDL can run as soon as a new replica starts. There is no automatic journal cleanup. Restoring an older backup can replay external operations, so workflow handlers must use stable idempotency keys.

## Logs

The process writes plain text to stdout and stderr. There is no log file, no log level setting, and no structured logging configuration, so collect the process output with your init system or container runtime.

Cluster readiness logs include the advertised private runner address. Failures on `/configure` and in the config layer omit submitted values and are recorded as a classification plus a PostgreSQL error code, precisely so a submitted secret cannot end up in the log. That is also why a `/configure` error in the log is terse, and why it is worth pairing with the message the page showed the operator.

Four lines are worth alerting on. `Database pool idle client error` means an idle pooled connection failed, and it carries the pool name, the error code, and the pool counts. Repeated occurrences point at the pooler, a network path, or a server restart. `Migration '<name>' failed` means a migration run stopped, and the page has the detail. `Ignoring invalid stored config value for '<key>'` means a stored setting no longer decodes, so the deployment is running as if that setting were unset. `API request failed` marks a `500` from the public API, with the stage and error code.

## Connection pooling

Point `DATABASE_URL` at a transaction-pooling pooler. The native Effect client uses unnamed queries with `prepare: false`. Keep `pool_mode = transaction` and a non-zero `max_prepared_statements` for clients that use named prepared statements, as in the reference setup, which sets it to 200.

Each application process opens two independent pools, one for the authentication client with up to 5 connections and one for the main application client with up to 10, so budget up to 15 client connections to PgBouncer per replica. Budget PostgreSQL backend connections separately using PgBouncer pool sizes and database limits. Both pools use an explicit five-second connection timeout. Both pools close a connection after 30 seconds idle and recycle one after 30 minutes of life, which keeps a pooler or NAT idle timeout from handing back a connection that has quietly died. TCP keepalives are on for the same reason.

Size the pooler's own limits for the number of replicas you run, and remember that the migration runner holds one connection for the duration of a migration run.

## Rate limits

Counters live in the shared `rate_limit` table, so every replica enforces the same window.

| Bucket | Limit | Scope |
| --- | --- | --- |
| Operator sign-in at `/configure` | 5 per minute | The whole deployment. Cleared by a successful sign-in |
| Chat requests | 20 per 60 seconds | Organization, Tenant, and tenant user combined |
| Sign-up, password reset, verification email, and organization invite | 5 per 60 seconds each | The requesting client address |
| Management API with an API key | 100 per 5 minutes | The API key |
| Management API with a chat token | 100 per 5 minutes | The token's identity |

Exceeding a limit returns `429` with a `Retry-After` header. Before the first migration the `rate_limit` table does not exist yet, and the two callers behave differently: operator sign-in lets the attempt through so first boot is possible, while the chat endpoint answers `500` with `Request limit could not be checked.`. Apply the migrations and the counters start working.

**TIP**: The operator bucket counts attempts for the deployment as a whole rather than per client address, so add an ingress-level limit in front of `/configure` if you want per-address throttling during setup.

## Seeding a demo environment

`db-seed` fills a database with everything a demo or a browser test would otherwise create by hand: deployment configuration, verified accounts, two organizations with members and a pending invitation, agents, organization API keys, Tenants and tenant users, and a Docker sandbox provider. It skips `/configure`, sign-up, email verification, and API key creation.

Run these commands to recreate the local database, migrate it, and seed it:

```sh
deno task --cwd platform db-reset
deno task --cwd platform db migrate
deno task --cwd platform db-seed
```

The seed prints every account with its password, each agent's public ID, and each API key's full value. It skips any setting that has an environment override, and stores `OPENAI_API_KEY` from the environment as every seeded organization's own OpenAI API key.

It refuses anything but a loopback database host, reporting `Refusing to seed the database at '<host>': seeding writes fixed development credentials and is limited to a loopback host`, because it writes fixed, published credentials. It also requires `DATABASE_ENCRYPTION_KEY`, refuses to run against an unmigrated database, runs in one transaction, and can be re-run to restore the fixture values.

**NOTE**: `db-reset` drops and recreates the disposable local database that `DATABASE_URL` selects. Skip it to seed into an already-migrated database, and never point either command at anything holding real data.
