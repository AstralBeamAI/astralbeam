# Operations

Back up the database and files before upgrading, check health after a restart, and use logs to diagnose failures. For a new installation, follow [Deploy](./deploy.md).

The binary's database commands use the same database selection and working-directory `.env` as `start`. Stop Platform before running maintenance against its embedded database. Run `bun run` commands from a checkout of the deployed version.

## HTTP workers

`WORKERS` defaults to `auto`: one HTTP worker per available CPU on Linux, plus a supervisor. macOS and Windows use one HTTP worker. Set `WORKERS=1` for a single worker or choose a positive count on Linux, such as `WORKERS=2 astralbeam-platform start`.

Linux workers share the public HTTP port. Leave `CLUSTER_RUNNER_PORT` unset or `0` for distinct private runner ports. Multiple workers require a fixed public TCP port and cannot use `NITRO_UNIX_SOCKET`. The supervisor restarts exited workers with backoff capped at 30 seconds, and workers exit if their supervisor dies.

Memory, extracted assets, sandbox leases, and sandbox/preview concurrency limits are per worker. Size `WORKERS` for memory, provider capacity, and the [connection budget](#connection-pooling). Request logs include `process.pid` to identify the serving worker.

## Applying migrations

Application migrations ship with each release. When migrations are pending, pages redirect to `/configure`.

1. [Back up the database and files](#backups-and-restore) before upgrading a populated deployment.
2. Open **Database migrations** at `/configure` and review the pending SQL and any TypeScript steps.
3. Apply the reviewed set. Other replicas refresh migration state on their next read after the five-second cache expires.

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

## Data directory

The default data directory is `~/.local/share/astralbeam` on Linux, `~/Library/Application Support/AstralBeam` on macOS, or `%LOCALAPPDATA%\AstralBeam` on Windows. `ASTRALBEAM_DATA_DIR` overrides it, and an absolute `XDG_DATA_HOME` changes the Unix default to `$XDG_DATA_HOME/astralbeam`. Preserve this location across upgrades:

| Path | Contents |
| --- | --- |
| `storage/` | Uploaded and generated files, avatars, logos, and previews when using File System. An explicit **Storage directory** can place these elsewhere |
| `postgres/` | Persistent embedded PostgreSQL database |
| `embedded-postgres.json` | Private database credentials and the generated encryption key, when present. Preserve with the database |
| Runtime caches | Downloaded executables, images, and temporary sandbox state |

Stop Platform before rerunning bootstrap. Keep the same working directory, environment, and data directory.

Microsandbox workspaces are temporary. Original attachments and published artifacts live in configured file storage, so downloads do not depend on preserving VM state. Docker keeps its images and containers with its configured daemon.

## Backups and restore

Because file state spans PostgreSQL and the configured filesystem directory or S3 bucket, stop all application replicas before backing up the database and files.

For embedded PostgreSQL, stop the executable and copy its data directory, including `postgres/` and `embedded-postgres.json`, together with configured file storage. Preserve permissions and the active encryption keyring when restoring. PostgreSQL major-version upgrades require dump and restore.

For external PostgreSQL, dump the database with all replicas stopped:

```sh
pg_dump --format=custom --file=astralbeam.dump "$DATABASE_URL"
```

Keep the replicas stopped. For File System, back up the entire configured directory, preserving relative paths and private permissions, and record its absolute path from **File storage**. For S3, use the provider's backup or export tool to copy the bucket's objects with their original keys and metadata. Record the endpoint, region, bucket name, and addressing mode alongside the backup.

Restoring encrypted settings and credentials requires the matching `DATABASE_ENCRYPTION_KEY`. A copied data directory requires the same PostgreSQL major version. Use a [SQL dump for major-version changes](https://www.postgresql.org/docs/18/upgrading.html#UPGRADING-VIA-PG-DUMP), with the required extensions available. See [Security](./security.md).

**NOTE**: Keep an independent keyring backup in your secret manager. The embedded database's credentials file can also contain its generated encryption key, so protect the complete directory backup as secret data.

To restore an external database, keep replicas stopped and load the dump into an empty database:

```sh
pg_restore --dbname="$DATABASE_URL" astralbeam.dump
```

Restore files to the directory or bucket recorded in the restored configuration, keeping their relative paths or object keys unchanged. If you use a different destination, update **File storage** at `/configure` and restart every server instance. Saving settings does not copy objects.

Start the application with the restored `DATABASE_URL` and matching encryption keyring. Apply any pending migrations at `/configure`. Verify that stored secrets are readable and that an existing attachment can be downloaded. Test this restore procedure before relying on a backup.

### Scheduled online database backups to S3

The [backup script](https://github.com/AstralBeamAI/astralbeam/blob/main/scripts/backup-postgres.sh) uploads compressed, AES-256-encrypted online snapshots to UTC paths such as `s3://bucket/prefix/20261110/20261110143025123.dump.gpg`.

1. Install Bash, Python 3, GnuPG, AWS CLI v2, and PostgreSQL clients matching the server's major version with Zstandard support. Put the script at `/usr/local/bin/backup-postgres`, mode `0755`, with disk space for compressed and encrypted copies.

2. Create `/etc/postgres-backup.env`, owned by the cron user with mode `0600`. Use URL-encoded database credentials with full dump access and a private bucket with upload permission:

   ```sh
   export DATABASE_URL='postgresql://astralbeam:your-password@127.0.0.1:5432/astralbeam'
   export DATABASE_ENCRYPTION_KEY='your-existing-encryption-key'
   export S3_URI=s3://your-private-bucket/postgres/astralbeam
   export AWS_ACCESS_KEY_ID='your-access-key-id'
   export AWS_SECRET_ACCESS_KEY='your-secret-access-key'
   export AWS_REGION=your-bucket-region
   # Temporary credentials: export AWS_SESSION_TOKEN='your-session-token'
   # Without Zstandard support: export BACKUP_COMPRESSION=gzip
   ```

   Preserve the exact, nonempty, single-line encryption keyring and its historical values in your secret manager.

3. Let's test one backup: `/bin/bash -c '. /etc/postgres-backup.env && exec /usr/local/bin/backup-postgres'`.

4. Schedule daily at 02:00 host time in root's crontab. Linux `flock -n` skips overlapping runs:

   ```cron
   PATH=/usr/local/bin:/usr/bin:/bin
   0 2 * * * /usr/bin/flock -n /var/lock/postgres-backup.lock /bin/bash -c '. /etc/postgres-backup.env && exec /usr/local/bin/backup-postgres' >> /var/log/postgres-backup.log 2>&1
   ```

   Use one scheduler per prefix. Rotate logs, monitor missing backups, and configure bucket retention and incomplete-multipart cleanup.

[ACCESS SHARE locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-TABLES) allow ordinary reads and writes. The five-second timeout limits acquisition, not duration. Avoid concurrent migrations, `TRUNCATE`, and `VACUUM FULL`. Locks release before encryption and upload.

To test recovery, set `RESTORE_DATABASE_URL` to an empty database with the required extensions, roles, and tablespaces. Use the original encryption key, AWS read credentials, and the exact S3 key. Run in Bash:

```sh
set -euo pipefail
umask 077
aws s3 cp s3://your-private-bucket/postgres/astralbeam/YYYYMMDD/EXACT_TIMESTAMP.dump.gpg ./restore.dump.gpg
gpg --batch --pinentry-mode loopback --no-symkey-cache --passphrase-fd 0 \
  --decrypt ./restore.dump.gpg <<< "$DATABASE_ENCRYPTION_KEY" > ./restore.dump
pg_restore --no-password --exit-on-error --dbname="$RESTORE_DATABASE_URL" ./restore.dump
```

Discard partial plaintext after decryption failure. Do not pipe decryption into `pg_restore`.

**NOTE**: This excludes cluster roles, tablespaces, and point-in-time recovery. For complete AstralBeam recovery or embedded PostgreSQL, follow the coordinated database, files, and keyring procedure above.

## Health checks

| Endpoint | Behavior |
| --- | --- |
| `/api/status` | `200` with `{"status":"ok"}` when the database query succeeds, otherwise `503` |
| `/api/v1/*` | `503` with `Retry-After: 10` and a problem document whose detail is `Server configuration required.` while setup is incomplete |
| `/api/auth/*` | `503` while bootstrap or deployment configuration is incomplete |
| Application pages except `/docs` and `/configure` | Redirect to `/configure` while setup is incomplete |

Point a process supervisor or load balancer probe at `/api/status`. It does not check cluster readiness. There is no separate readiness endpoint. For API readiness, probe an API route and treat `503` as not ready and `401` as ready.

## Shutdown

SIGTERM and SIGINT start a single shutdown sequence. The server stops accepting requests and gives active responses, including streams, up to five seconds to finish. It then stops the cluster runner, destroys live chat sandboxes, closes both database pools, and exits. That cleanup has five seconds of its own, and a failure or timeout exits with status 1. Give an external supervisor at least fifteen seconds before sending SIGKILL so the parent can stop all workers.

Long-lived streams can be disconnected. Accepted durable work remains recoverable through PostgreSQL. Reconnect to inspect the result.

## Cluster readiness and recovery

Each process runs a cluster runner for durable background work. If logs show `Cluster runner unavailable`, check database connectivity, private runner reachability, and database permissions. `Cluster runner ready` indicates successful initialization.

Replicas discover peers through the shared database and authenticate with a credential derived from `DATABASE_ENCRYPTION_KEY`. Use the same keyring on every replica. Runner addresses default to private IPv6, then private IPv4, falling back to loopback. Set `CLUSTER_RUNNER_HOST` to a reachable private address if discovery chooses the wrong interface. `CLUSTER_RUNNER_PORT` defaults to `0` for an assigned port and must stay `0` with multiple HTTP workers.

Keep runner ports reachable between replicas on a trusted private network. Do not expose them through the public proxy or advertise a shared load balancer address. Restart after changing runner settings.

The supervisor retries failed runners with backoff capped at 30 seconds. `/configure` remains available for repair when its database dependencies are reachable. After a crash, another runner recovers persisted work when its leases expire. Recovery is not immediate, and an external operation can repeat if its result was not saved before the crash.

Effect creates and upgrades `effect_cluster_*` storage automatically at startup, outside the application's migration approval flow. Include every cluster table in backups, including `effect_cluster_migrations`. The database role needs CONNECT, schema USAGE/CREATE, table read/write access, sequence access, and permission to alter cluster tables. Check rolling-version compatibility before upgrading Effect. There is no automatic journal cleanup. Restoring old work can replay external operations, so workflow handlers need stable idempotency keys.

## Logs

Collect stdout and stderr with your init system or container runtime. Application request and Effect logs use ECS JSON in development and production. Startup commands can also print plain text. The application does not manage log files. `LOG_LEVEL` sets the minimum level and defaults to `Info`, for example `LOG_LEVEL=Debug` includes debug entries.

Startup checks sandbox availability in parallel and prints `Sandbox <provider>: available`, `unavailable`, or `disabled`. External providers are always available here. Credentials and execution are verified by their connection test.

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

Budget up to 15 client connections per worker: 5 for authentication and 10 for the main application. Size PostgreSQL backend connections separately using the pooler's limits. Both pools use a five-second connection timeout, close connections after 30 seconds idle, and recycle them after 30 minutes.

Size the pooler's own limits for the total worker count, and remember that the migration runner holds one additional connection for the duration of a migration run.

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
