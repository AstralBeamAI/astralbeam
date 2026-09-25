# Platform database

The Platform owns its server-only PostgreSQL client, Drizzle schema, and generated migrations in this directory.

## Structure

- `index.ts` is guarded as server-only and owns the separate process-wide pools, managed runtime and idempotent shutdown. It exports the Promise Drizzle client, Effect database service and replaceable layer, and framework bridge through `@/db`.
- `config.server.ts` validates decrypted values from the global `config` table and recovers unreadable rows for `/configure`. The Drizzle column codec owns encryption, while `src/lib/config` adds environment precedence and process-local caching through `getGlobalConfig`.
- `migration-runner.server.ts` reads and applies the bundled Drizzle migrations approved through `/configure`.
- `lib/` contains reusable database primitives such as credentials and encryption, PostgreSQL types and errors, optimistic locking, and rate limiting.
- `schema.server.ts` is the schema entrypoint and re-exports every table and relation Drizzle Kit must discover.
- `schema/` contains responsibility-named domain table and relation modules.
- `migrations/` contains generated migration SQL and Drizzle snapshots.

`schema/tables.server.ts` is the table-only namespace shared by Drizzle and adapters. `schema/relations.server.ts` creates the base relation definition, adds Better Auth's generated-shape relation part, and exports the single composition root passed to `drizzle()`.

## Query from server-only code

Tenant and TenantUser name/external-ID substring searches use `pg_trgm` GIN indexes, installed by migration. The migration role needs permission to create the extension. Short or punctuation-only terms without extractable trigrams may still scan their scope. See [PostgreSQL index support](https://www.postgresql.org/docs/18/pgtrgm.html#PGTRGM-INDEX).

Use the Drizzle client from server-only code, after authorizing the organization ID at the request boundary:

```ts
import { getAuthDatabase } from "@/db"
import { eq } from "drizzle-orm"
import { agent } from "@/db/schema.server"

export const listOrganizationAgents = (organizationId: string) =>
  getAuthDatabase().select().from(agent).where(eq(agent.organizationId, organizationId))
```

Database imports belong in server-only code and do not initialize resources. Database operations require `DATABASE_URL`, and encrypted values require `DATABASE_ENCRYPTION_KEY`. When a table has database functions such as those in `config.server.ts`, use them instead of querying the table directly so encryption, validation, and optimistic locking cannot be bypassed. Application reads of global configuration use the cached, environment-aware `getGlobalConfig` entry point. Include dynamic row identity inside encrypted payloads and compare it with sibling columns at the table boundary.

## Local services

On macOS, run Deno natively and use Docker Compose or Podman Compose for database services. PgBouncer is the only host-published database endpoint. From the repository root, choose one:

```sh
docker compose up --detach --wait
```

```sh
podman compose up --detach
podman compose ps
```

Wait for healthy services before database commands. See [Setup](../../../SETUP.md#option-2-run-directly-on-macos) for runtime installation and port overrides.

Worktree setup copies the primary checkout's ignored `platform/.env.development.local`, or creates it when absent, and appends a `DATABASE_URL` for that worktree. The database name is the unique worktree folder: for example, Codex worktree `.../worktrees/a3f4/astralbeam` uses database `a3f4`. An exported shell `DATABASE_URL` remains authoritative.

## Database commands

Run these commands from the repository root. Apply every checked-in migration that has not yet run against the configured database:

```sh
deno task --cwd platform db migrate
```

After changing the TypeScript schema, generate a named migration, inspect its SQL and snapshot, verify migration-history consistency, then apply it:

```sh
deno task --cwd platform db generate --name=add-projects
deno task --cwd platform db check
deno task --cwd platform db migrate
```

From the repository root, drop and recreate only the confirmed-disposable database selected by Drizzle for the current worktree:

```sh
deno task --cwd platform db-reset
deno task --cwd platform db migrate
```

`db-reset` only recreates the selected disposable database. Apply migrations separately and never reset shared Compose volumes. Drizzle `check` validates migration-history consistency, not the live database's applied migrations.

## Seed sample data

`deno task --cwd platform db-seed` fills the current worktree's database with global configuration, dogfood and sample organizations, verified accounts, members, agents, organization API keys, Tenants and tenant users, and a Docker sandbox provider. It skips `/configure`, signup, email verification, and API-key creation entirely.

```sh
deno task --cwd platform db-reset
deno task --cwd platform db migrate
deno task --cwd platform db-seed
```

The seed runs in one transaction and can be rerun to restore fixture values. It identifies organizations by UUID and preserves edited URL slugs. It accepts only loopback database hosts because it writes fixed development credentials.

It prints every account with its password, each agent's public ID, each API key's full value, and ready-to-paste blocks for `examples/todos/.env` and `examples/todos-rails/.env`. `scripts/seed/fixtures.ts` is the single source of those values, and `examples/todos/e2e` imports it directly.

The seed skips configuration keys with an uppercase environment override, and writes `OPENAI_API_KEY` as every seeded organization's own encrypted key, because `/api/v1/chat` streams on the organization's key rather than a deployment one. Put the OpenAI key in `platform/.env.local`, which `scripts/copy-worktree-env.sh` copies into every worktree. See [environment configuration](../../../SETUP.md#configure-the-environment) for precedence and `/configure` behavior.

## Drizzle migration workflow

Drizzle is schema-first: `src/db/schema.server.ts` is the hand-authored schema entrypoint, and `generate` compares it with the latest existing Drizzle snapshot rather than the live database. Out-of-band database changes are therefore invisible to generation.

Each generated `src/db/migrations/<timestamp>_<name>/` directory is one migration unit:

- `migration.sql` is the forward SQL that `migrate` executes and records in the database migration log.
- `snapshot.json` is Drizzle Kit-owned metadata describing the complete Drizzle-managed schema after that migration and its place in migration history. PostgreSQL never executes it, and it is not a database or data backup.

Review the SQL and commit it with its matching snapshot and TypeScript schema change. Do not edit snapshots by hand.

- Reverse applied changes with a forward migration. There is no automatic rollback command, and migration history that may have reached a shared environment must never be rewritten.
- Resolve rename prompts carefully to avoid accidental drop-and-create SQL.
- Schema diffs cannot infer data backfills or transformations. Use `deno task --cwd platform db generate --custom --name=backfill-projects` for data migrations or unsupported DDL.
- Apply application schema changes only through reviewed, checked-in migration files with `migrate`. Effect initializes and migrates its own `effect_cluster_*` tables at runner startup, outside Drizzle schema management. See [cluster storage ownership](../cluster/README.md#storage-and-deployment) for privileges and upgrade requirements. Never use Drizzle `push`, including `push --explain`, in any environment or for local prototypes.
- This repository uses colocated migration folders, not root SQL files and `meta/_journal.json`.
- `up` upgrades metadata on disk. `migrate` applies pending migrations to PostgreSQL.

## Relations v2 composition

The relation composition root always spreads `baseRelations` first and then each responsibility-named relation part. Better Auth core and its organization plugin remain together in the generated-shape `authRelations` part.

When adding a domain such as billing or projects:

1. Add its tables to a responsibility-named schema module and re-export them from `schema/tables.server.ts`.
2. Define one relation part, such as `billingRelations`, with `defineRelationsPart(schema, ...)`.
3. Spread that part after `baseRelations` in `databaseRelations`.

Each source table must be owned by exactly one relation part. Two parts defining the same source table would allow a later object spread to silently replace relationships from the earlier part. See Drizzle's [Relations v2 part ordering](https://orm.drizzle.team/docs/relations#relations-parts).

## PostgreSQL cache

`cache.server.ts` provides schema-typed JSON reads, writes, deletes, and transaction-scoped key locking through the existing Effect SQL client. The global `cache_entry` table isolates keys by namespace. Effect v4's `KeyValueStore.toSchemaStore` handles serialization. Direct SQL keeps the adapter usable from the native Deno worker and CLI without importing the web server's database runtime.

```ts
import { Schema } from "effect"
import { runDatabaseEffect } from "@/db"
import { deleteDatabaseCache, readDatabaseCache, writeDatabaseCache } from "@/db/cache.server"

const options = { namespace: "example:v1", key: "hello", schema: Schema.String }
await runDatabaseEffect(writeDatabaseCache({ ...options, value: "world", timeToLive: "5 minutes" }))
await runDatabaseEffect(writeDatabaseCache({ ...options, value: "updated", timeToLive: "1 hour" }))
const value = await runDatabaseEffect(readDatabaseCache(options)) // Option.some("updated")
await runDatabaseEffect(deleteDatabaseCache(options))
```

Writes insert missing keys or atomically replace both value and expiration for an existing namespace/key pair, using last-write-wins semantics. Updates preserve `id` and `created_at` and refresh `updated_at`. Omitted or infinite `timeToLive` means no expiration, and zero or negative TTL expires immediately. PostgreSQL's statement clock determines expiration. Reads never extend TTL. The [storage rationale](schema/cache.server.ts) explains each column and index, the alternatives, and the upstream references.

Only `deleteDatabaseCache` removes rows, for the exact namespace/key pair whether expired or live. Cleanup is deferred: expired rows remain stored but unreadable through the cache API until explicitly deleted. PostgreSQL autovacuum reclaims dead row versions after deletion, but does not delete entries based on TTL.

Namespaces allow at most 64 Unicode code points and keys at most 512, enforced in both the application and database. Oversized inputs and unpaired Unicode surrogates fail with `KeyValueStoreError` before a cache query. Rejecting unpaired surrogates keeps advisory-lock identities consistent with UTF-8 database keys. TTL conversion also fails before database access. Database and codec failures propagate to callers. JSON `null` is a cached value, distinct from a miss.

Authorize access before cache operations. Include all input and identity dimensions in the key, using immutable Organization and Tenant UUIDs. Use a new namespace version when the value schema changes incompatibly. This table is not an encrypted secret store.

`withDatabaseCacheLock({ namespace, key }, effect)` runs an Effect inside a transaction-scoped key lock, including when the key does not exist. Read the current value inside that Effect before updating it. Public writes and deletes participate in the same locking protocol. The lock remains held until the enclosing transaction commits or rolls back. Use the same SqlClient with the default PostgreSQL READ COMMITTED isolation for every participating query, and acquire multiple keys in a consistent order to avoid deadlocks. Never perform slow external calls while holding a lock. See [transaction-level advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).

For durable metadata, omit TTL and reserve a namespace that ordinary cache invalidation must never delete. These records remain until explicitly deleted.

The integration suite requires a disposable loopback `DATABASE_URL` whose database name ends in `_test`, with checked-in migrations applied.

Reference: [Effect KeyValueStore](https://effect.website/docs/v4/api/effect/unstable/persistence/KeyValueStore).
