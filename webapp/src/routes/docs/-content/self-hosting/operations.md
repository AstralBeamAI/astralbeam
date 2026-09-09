# Operations

Day-two tasks for a running deployment: migrations, backups, health, logs, pooling, and rate limits. Install first with [Deploy](./deploy.md).

Commands run from a checkout of the deployed version, from the repository root, in the `deno task --cwd webapp <task>` form, and need `DATABASE_URL` in the environment.

## Applying migrations

Migrations ship inside the artifact. When a release adds one, the setup gate closes on every replica, pages redirect to `/configure`, and the page shows a **Database migrations** card with the pending count, how many are already applied, and each migration's full SQL behind a disclosure. Read the SQL, back up the database if it holds data you cannot lose, then apply.

What happens when you apply:

- The run takes a PostgreSQL advisory lock, so only one migration run happens at a time across all replicas. A second attempt returns `A migration run is already in progress`.
- The page approves the exact set it showed you, by name and SQL digest. If the pending set changed in between, the run is refused with `The pending migrations changed; review them again`, and you review the new list.
- Each migration runs in its own transaction and is recorded before the next one starts.

A failure stops the run and reports `Migration '<name>' failed: <code>: <message>`. The migrations before it stay applied and recorded, the failed one is rolled back, and nothing after it runs. Fix the cause, then apply again from the same page. The already-applied migrations are not re-run.

There is no rollback. Reverse an applied change with a new forward migration.

## Database commands

The operator page and the Drizzle CLI write the same bookkeeping table, `drizzle.__drizzle_migrations`, and match applied migrations by name, so they are interchangeable. Use the CLI when you would rather migrate before restarting, or when you have no browser access to `/configure`.

```sh
deno task --cwd webapp db migrate
deno task --cwd webapp db check
```

`migrate` applies every checked-in migration that has not run yet. `check` validates the consistency of the migration history on disk, not the state of the live database. Never use `push` against a database with data you care about.

## Backups and restore

All state is in PostgreSQL, so a logical dump of the one database is a complete backup.

```sh
pg_dump --format=custom --file=astralbeam.dump "$DATABASE_URL"
```

Two things make an AstralBeam dump different from an ordinary one.

- The dump is useless without the matching `DATABASE_ENCRYPTION_KEY`. Deployment settings and sandbox provider credentials are stored as ciphertext keyed from it, as described in [Security](./security.md). Back the keyring up in your secret manager, separately from the dump, and never in the same place.
- Restore into a server at the same PostgreSQL major version or newer, with the `citext` extension available.

To restore, create an empty database, load the dump, and start the application with the same `DATABASE_URL` and the encryption keyring that was in effect when the dump was taken. If the restored data predates the running version, the setup gate closes until you approve the missing migrations.

```sh
pg_restore --dbname="$DATABASE_URL" astralbeam.dump
```

Test a restore before you need one, and confirm afterwards that `/configure` can read the stored secrets rather than reporting them unreadable.

## Health checks

| Endpoint      | Behavior                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/api/status` | Liveness only. Always `200` with `{"status":"ok"}`. It never touches the database or reads the request                         |
| `/api/v1/*`   | `503` with `Retry-After: 10` and a problem document whose detail is `Server configuration required.` while setup is incomplete |
| `/api/auth/*` | `503` with `{"error":"Application is not configured"}` while setup is incomplete                                               |
| Page routes   | Redirect to `/configure` while setup is incomplete                                                                             |

Point a process supervisor or load balancer liveness probe at `/api/status`. There is no readiness endpoint: because the liveness probe deliberately answers without reading anything, it stays `200` when the database is down. For readiness, probe an API route and treat `503` as not ready and `401` as ready.

## Logs

The process writes plain text to stdout and stderr. There is no log file, no log level setting, and no structured logging configuration, so collect the process output with your init system or container runtime.

Log lines never contain configuration values. Failures on `/configure` and in the config layer are recorded as a classification plus a PostgreSQL error code precisely so that a submitted secret cannot end up in the log. That is also why a `/configure` error in the log is terse: pair it with the message the page showed the operator.

Lines worth alerting on:

| Line                                               | Meaning                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Database pool idle client error`                  | An idle pooled connection failed. Includes the pool name, error code, and pool counts. Repeated occurrences point at the pooler, a network path, or a server restart |
| `Migration '<name>' failed`                        | A migration run stopped. The page has the detail                                                                                                                     |
| `Ignoring invalid stored config value for '<key>'` | A stored setting no longer decodes, so the deployment is running as if it were unset                                                                                 |
| `API request failed`                               | A `500` from the public API, with the stage and error code                                                                                                           |

## Connection pooling

Point `DATABASE_URL` at a transaction-pooling pooler. The application uses prepared queries, so the pooler must track prepared statements: with PgBouncer that is `pool_mode = transaction` plus a non-zero `max_prepared_statements`, which the reference setup sets to 200. Without it, queries start failing as soon as a statement is prepared.

Each application process opens two independent pools, one for the authentication client with up to 5 connections and one for the main application client with up to 10, so budget up to 15 server-side connections per replica. Both pools close a connection after 30 seconds idle and recycle one after 30 minutes of life, which keeps a pooler or NAT idle timeout from handing back a connection that has quietly died. TCP keepalives are on for the same reason.

Size the pooler's own limits for the number of replicas you run, and remember that the migration runner holds one connection for the duration of a migration run.

## Rate limits

Counters live in the shared `rate_limit` table, so every replica enforces the same window.

| Bucket                                                               | Limit                 | Scope                                                 |
| -------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| Operator sign-in at `/configure`                                     | 5 per minute          | The whole deployment. Cleared by a successful sign-in |
| Chat requests                                                        | 20 per 60 seconds     | Organization, Tenant, and tenant user combined        |
| Sign-up, password reset, verification email, and organization invite | 5 per 60 seconds each | The requesting client address                         |
| Management API with an API key                                       | 100 per 5 minutes     | The API key                                           |
| Management API with a chat token                                     | 100 per 5 minutes     | The token's identity                                  |

Exceeding a limit returns `429` with a `Retry-After` header. If the `rate_limit` table does not exist yet, which is only true before the first migration, operator sign-in allows the attempt through so first boot is possible, while the chat endpoint answers `500` with `Request limit could not be checked.`. Apply the migrations and the counters start working.

The operator bucket counts attempts for the deployment as a whole rather than per client address, so add an ingress-level limit in front of `/configure` if you want per-address throttling during setup.

## Seeding a demo environment

`db-seed` fills a database with everything a demo or a browser test would otherwise create by hand: deployment configuration, verified accounts, two organizations with members and a pending invitation, agents, organization API keys, Tenants and tenant users, and a Docker sandbox provider. It skips `/configure`, sign-up, email verification, and API key creation.

```sh
deno task --cwd webapp db-reset
deno task --cwd webapp db migrate
deno task --cwd webapp db-seed
```

`db-reset` drops and recreates the disposable local database that `DATABASE_URL` selects, so run it only against a database you are willing to lose. Skip it to seed into an already-migrated database.

The seed refuses anything but a loopback database host, reporting `Refusing to seed the database at '<host>': seeding writes fixed development credentials and is limited to a loopback host`, because it writes fixed, published credentials. Tunnel a remote database to loopback if you really mean it. It also requires `DATABASE_ENCRYPTION_KEY`, refuses to run against an unmigrated database, runs in one transaction, and can be re-run to restore the fixture values.

The seed prints every account with its password, each agent's public ID, and each API key's full value. It never writes `openai_api_key` and skips any setting that has an environment override. Never point it at anything that holds real data.
