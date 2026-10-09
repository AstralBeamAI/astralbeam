# Platform database

The Platform owns its server-only PostgreSQL client, Drizzle schema, and generated migrations in this directory.

## Structure

- `database.server.ts` owns the separate process-wide pools, the shared SQL runtime and idempotent shutdown. It exports the Promise Drizzle client for Better Auth and the `Database` service with its replaceable layer.
- `schema/config.server.ts` defines the global `config` table. Each row holds an encrypted `value`. The `Config` service in `src/lib/config` validates stored settings, recovers unreadable rows for `/configure`, and adds environment precedence and process-local caching. The shared model pricing catalog stores schema-validated JSON text in that same column and uses dedicated uncached reads so replicas see refreshed prices without restarting.
- `migration-runner.server.ts` reads and applies the bundled Drizzle migrations approved through `/configure`. `migrate-command.server.ts` serves the compiled CLI and `deno task db migrate`.
- `lib/` contains reusable database primitives such as credentials and encryption, PostgreSQL types and errors, optimistic locking, and rate limiting.
- `schema.server.ts` is the schema entrypoint and re-exports every table and relation Drizzle Kit must discover.
- `schema/` contains responsibility-named domain table and relation modules.
- `migrations/` contains generated migration SQL and Drizzle snapshots.

`schema/tables.server.ts` is the table-only namespace shared by Drizzle and adapters. `schema/relations.server.ts` creates the base relation definition, adds Better Auth's generated-shape and chat relation parts, and exports the single composition root passed to `drizzle()`.

## Query from server-only code

Tenant and TenantUser name/external-ID substring searches use `pg_trgm` GIN indexes, installed by migration. The migration role needs permission to create the extension. Short or punctuation-only terms without extractable trigrams may still scan their scope. See [PostgreSQL index support](https://www.postgresql.org/docs/18/pgtrgm.html#PGTRGM-INDEX).

Use the Effect-backed `Database` service from server-only code, after authorizing the organization ID at the request boundary:

```ts
import { Effect } from "effect"
import { Database } from "@/db/database.server"
import { eq } from "drizzle-orm"
import { agent } from "@/db/schema.server"

export const listOrganizationAgents = Effect.fn("listOrganizationAgents")(function* (
  organizationId: string,
) {
  const db = yield* Database
  return yield* db.select().from(agent).where(eq(agent.organizationId, organizationId))
}, Effect.orDie)
```

Database imports belong in server-only code and do not initialize resources. Database operations require `DATABASE_URL`, and encrypted values require `DATABASE_ENCRYPTION_KEY`. When a table has database functions such as those in `config.server.ts`, use them instead of querying the table directly so encryption, validation, and optimistic locking cannot be bypassed. Application reads of global configuration go through the cached, environment-aware `Config` service. Include dynamic row identity inside encrypted payloads and compare it with sibling columns at the table boundary.

JSONB columns use `schemaJsonb(schema)` from `lib/columns.server.ts`. Its synchronous Effect Schema codec validates Drizzle inserts, updates, ordinary reads, and relational JSON reads. Invalid values fail without including their content in the validation error. Structured records reject unknown fields, while Tenant and TenantUser metadata retain arbitrary JSON object keys. Raw SQL expressions and direct database access bypass this application validation. The PostgreSQL column types and existing constraints remain unchanged.

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

`db migrate` uses the application runner. Other `db` commands invoke the installed Drizzle Kit version.

`db-reset` only recreates the selected disposable database. Apply migrations separately and never reset shared Compose volumes. Drizzle `check` validates migration-history consistency, not the live database's applied migrations.

## Seed sample data

`deno task --cwd platform db-seed` fills the current worktree's database with global configuration, dogfood and sample organizations, verified accounts, members, agents, organization API keys, Tenants and tenant users, a Docker sandbox provider, and saved conversations for the todos tenant user and for `owner@example.com` in Astro on `acme`. It skips `/configure`, signup, email verification, and API-key creation entirely.

```sh
deno task --cwd platform db-reset
deno task --cwd platform db migrate
deno task --cwd platform db-seed
```

The seed runs in one transaction and can be rerun to restore fixture values. It identifies organizations by UUID and preserves edited URL slugs. It accepts only loopback database hosts because it writes fixed development credentials.

It prints every account with its password, each agent's public ID, each API key's full value, and ready-to-paste blocks for `examples/todos/.env` and `examples/todos-rails/.env`. `scripts/seed/fixtures.ts` is the single source of those values, and `examples/todos/e2e` imports it directly.

The seed skips configuration keys with an uppercase environment override. When `OPENAI_API_KEY` is present, it creates a **Development OpenAI** connection, enables its model, and assigns it to agents in sample organizations and dogfood that have no provider. Rerunning the seed preserves existing provider credentials, enabled models, and agent assignments. Put the OpenAI key in `platform/.env.local`, which `scripts/copy-worktree-env.sh` copies into every worktree. See [environment configuration](../../../SETUP.md#configure-the-environment) for precedence and `/configure` behavior.

## Drizzle migration workflow

Drizzle is schema-first: `src/db/schema.server.ts` is the hand-authored schema entrypoint, and `generate` compares it with the latest existing Drizzle snapshot rather than the live database. Out-of-band database changes are therefore invisible to generation.

Each generated `src/db/migrations/<timestamp>_<name>/` directory is one migration unit:

- `migration.sql` is the forward SQL that `migrate` executes and records in the database migration log.
- `snapshot.json` is Drizzle Kit-owned metadata describing the complete Drizzle-managed schema after that migration and its place in migration history. PostgreSQL never executes it, and it is not a database or data backup.

Review the SQL and commit it with its matching snapshot and TypeScript schema change. Do not edit snapshots by hand.

- Reverse applied changes with a forward migration. There is no automatic rollback command, and migration history that may have reached a shared environment must never be rewritten.
- Resolve rename prompts carefully to avoid accidental drop-and-create SQL.
- Schema diffs cannot infer data backfills or transformations. Use `deno task --cwd platform db generate --custom --name=backfill-projects` for data migrations or unsupported DDL.
- Apply application schema changes only through reviewed, checked-in migration files with `migrate`. Effect initializes and migrates its own `effect_cluster_*` tables at runner startup, outside Drizzle schema management. See [cluster storage ownership](../lib/cluster/README.md#storage-and-deployment) for privileges and upgrade requirements. Never use Drizzle `push`, including `push --explain`, in any environment or for local prototypes.
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

`cache.server.ts` provides schema-typed JSON reads, writes, deletes, and transaction-scoped key locking through the existing Effect SQL client. `makeDatabaseCache` builds one Effect v4 `KeyValueStore.SchemaStore` per namespace and time to live, so build it once and reuse it. The global `cache_entry` table isolates keys by namespace, and `KeyValueStore.toSchemaStore` handles serialization. Direct SQL keeps the adapter usable from the native Deno worker and CLI without importing the web server's database runtime.

```ts
import { Effect, Schema } from "effect"
import { makeDatabaseCache } from "@/db/cache.server"

const greetings = Effect.gen(function* () {
  const cache = yield* makeDatabaseCache({
    namespace: "example:v1",
    schema: Schema.String,
    timeToLive: "1 hour",
  })
  yield* cache.set("hello", "world")
  const value = yield* cache.get("hello") // Option.some("world")
  yield* cache.remove("hello")
  return value
})
```

Writes insert missing keys or atomically replace both value and expiration for an existing namespace/key pair, using last-write-wins semantics. Updates preserve `id` and `created_at` and refresh `updated_at`. Omitting the store's `timeToLive` or passing an infinite one means no expiration, and zero or negative TTL expires immediately. PostgreSQL's statement clock determines expiration. Reads never extend TTL. [Cluster maintenance](../lib/workflows/README.md#scheduling) runs every five minutes and drains expired rows in batches of up to 1,000, pausing ten milliseconds between batches until a batch deletes no rows. Locked rows are skipped and remain eligible for a later run. The [storage rationale](schema/cache.server.ts) explains each column and index, the alternatives, and the upstream references.

`remove` deletes the exact namespace/key pair whether expired or live. Expired rows remain unreadable through the cache API until cluster maintenance or explicit deletion removes them. PostgreSQL autovacuum reclaims dead row versions after deletion, but does not delete entries based on TTL.

Namespaces allow at most 64 Unicode code points and keys at most 512, enforced in both the application and database. Oversized inputs and unpaired Unicode surrogates fail with `KeyValueStoreError` before a cache query. Rejecting unpaired surrogates keeps advisory-lock identities consistent with UTF-8 database keys. TTL conversion also fails before database access. Database and codec failures propagate to callers. JSON `null` is a cached value, distinct from a miss.

Authorize access before cache operations. Include the entity's full primary key as a colon-joined prefix, including its immutable Organization and Tenant UUIDs, plus any other input or identity dimensions. Use a new namespace version when the value schema changes incompatibly. This table is not an encrypted secret store.

`withDatabaseCacheLock({ namespace, key }, effect)` runs an Effect inside a transaction-scoped key lock, including when the key does not exist. Read the current value inside that Effect before updating it. Public writes and deletes participate in the same locking protocol. The lock remains held until the enclosing transaction commits or rolls back. Use the same SqlClient with the default PostgreSQL READ COMMITTED isolation for every participating query, and acquire multiple keys in a consistent order to avoid deadlocks. Never perform slow external calls while holding a lock. See [transaction-level advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).

`tryWithDatabaseCacheLock({ namespace, key }, effect)` uses the same locking protocol without waiting. It returns `Option.some(value)` after acquiring the lock and running the Effect, or `Option.none()` when another transaction holds the lock. Errors from the Effect still propagate.

For durable metadata, omit TTL and reserve a namespace that ordinary cache invalidation must never delete. These records remain until explicitly deleted.

The integration suite requires a disposable loopback `DATABASE_URL` whose database name ends in `_test`, with checked-in migrations applied.

Reference: [Effect KeyValueStore](https://effect.website/docs/v4/api/effect/persistence/KeyValueStore).

## Idempotent database writes

`lib/idempotency.server.ts` lets us replay a write's typed value or error when a client retries the same intended operation. Call `withDatabaseIdempotency({ scope, key, operation, parameters, namespace? }, execute)`. The namespace defaults to `"idempotency"`. Override it only when callers need separate key spaces. Each operation supplies a stable versioned name and Effect Schemas for its parameters, success, and expected error. The helper validates the parameters before execution and passes their decoded value to `execute`. HTTP status, headers, and body replay belong to a future transport adapter.

Keep the operation definition as module-level data, and keep its name and codecs compatible with retained records during deployments. If a framework validator has already decoded transformed parameters, use `Schema.toType(requestSchema)` for the operation's parameter schema. Include every input that affects the write, including route IDs, parent Tenant IDs, and optimistic lock versions. Comparing only the request body can replay a result for a different target.

After authorizing the caller, supply an immutable Organization UUID as the scope and the client's original key and parameters:

```ts
import { Effect, Schema } from "effect"
import { withDatabaseIdempotency } from "@/db/lib/idempotency.server"
import { Tenants } from "@/lib/tenants/tenants.server"
import { TenantExternalIdTaken, TenantWriteForbidden } from "@/lib/tenants/errors"
import { TenantRecordSchema, TenantWriteSchema } from "@/lib/tenants/schemas"

const tenantOperation = {
  name: "CreateTenant/v1",
  parameters: TenantWriteSchema,
  success: TenantRecordSchema,
  error: Schema.Union([TenantExternalIdTaken, TenantWriteForbidden]),
}

const example = (authorizedOrganizationId: string) =>
  Effect.gen(function* () {
    const tenants = yield* Tenants

    return yield* withDatabaseIdempotency(
      {
        scope: authorizedOrganizationId,
        key: "884793cd-bef4-46cf-8790-e3d4957a09ce",
        operation: tenantOperation,
        parameters: { externalId: "customer-123", name: "Example customer" },
      },
      (fields) => tenants.create({ scope: { organizationId: authorizedOrganizationId }, fields }),
    )
  })
```

Use a new key for each intended operation and reuse it for every retry. Keys contain 1 to 255 Unicode code points, and UUID v4 is a suitable default. Derive the scope by joining the full authorized primary key with colons, followed by the principal UUID where access requires isolation. The stored key retains this scope prefix and hashes only the client key. The scope must fit within 447 code points so the full cache key stays within its 512-code-point limit. Recheck authorization before every call, including a replay. Never use an editable Organization slug or trust a caller-supplied scope.

The helper atomically commits database writes and the Schema-encoded success. An expected failure rolls back the operation's writes and retains its typed error for replay, including errors considered retryable. Keep infrastructure errors outside the operation's declared error schema. Use the existing `mapDatabaseErrors` pattern to map constraint violations to domain errors and leave other database failures as defects. Keep retry policy inside `execute`. For database retries, wrap each attempt in `SqlClient.withTransaction` before applying `Effect.retry`, so a failed attempt rolls back before the next one runs. Retrying the wrapper after a declared failure only replays that failure.

A completed result lives for 24 hours without extension on reads, matching [Stripe's minimum key retention](https://docs.stripe.com/api/idempotent_requests) and [WorkOS Audit Log Event key expiration](https://workos.com/docs/reference/audit-logs/event). After expiration, the same key can execute again. Validation failures and defects, interruption, or storage failures before commit leave no new completed record, including causes containing both a declared failure and a defect or interruption. If an acknowledgement is lost during commit, retry the same key to replay a committed outcome or execute when nothing committed. A changed operation name or parameters under the same namespace, scope, and key fails with `IdempotencyParametersMismatch`. A concurrent request fails immediately with `IdempotencyInProgress` so the caller can retry the same key later. Their error schemas carry HTTP status annotations of `400` and `409`. The wrapper performs no automatic retries.

The helper owns its top-level transaction. Calling it inside an existing transaction is a programming defect. Every protected write must use the same Effect SqlClient. Let the existing runtime boundary handle storage and codec failures, and expose only declared domain errors and idempotency conflicts. Keep the namespace dedicated to idempotency records because ordinary cache invalidation would remove their protection. Parameters and results are stored without encryption, so keep credentials and other secrets outside these records. Future HTTP consumers must normalize a replayable internal error into a safe declared error before returning a `500` response. See [Effect Schema](https://effect.website/docs/v4/api/effect/Schema).

**NOTE**: Direct email delivery, sandbox provisioning, and other provider calls do not belong inside this transaction. For external work, submit a [durable workflow](../lib/workflows/README.md) through storage participating in the same transaction and return an accepted handle. Because workflow journals can outlive the 24-hour cache, generate a new domain operation ID for each fresh submission and replay its accepted handle. The worker still needs a stable provider idempotency key or reconciliation for uncertain outcomes. Effect's [Workflow identity](https://effect.website/docs/v4/api/effect/workflow/Workflow) and [Activity idempotency keys](https://effect.website/docs/v4/api/effect/workflow/Activity) provide the corresponding durable execution primitives.

Chat admission already uses the helper for acceptance receipts. The following integrations remain candidates:

| Use case | Protected operation | Inputs to compare |
| --- | --- | --- |
| Tenant and TenantUser creation or update | Database write and its typed resource result | Fields or patch, target ID, parent Tenant ID |
| Agent and other dashboard writes | Database mutation and its typed response | Fields, target ID, expected lock version |
| Organization deletion | Durable deletion submission and its accepted handle | Organization UUID and caller's deletion intent |
| Future email submission | Durable delivery submission and its accepted handle | Recipient, template, content, schedule |
| Future sandbox submission | Durable provisioning submission and its accepted handle | Provider ID and provisioning options, excluding secrets |

Delete retained records using both their namespace and full authorized scope prefix. For chat admission, keys start with `organizationId:tenantId:threadId:tenantUserId:`. Thread deletion purges its prefix, and Organization deletion delegates to Tenant deletion, which purges the Tenant prefix after cascading its owned rows.

Tenant and TenantUser creation are the first candidates, where retrying an accepted create would otherwise return a uniqueness conflict. Agent writes already use Effect-backed Drizzle transactions, which can join this helper's transaction as savepoints. Organization deletion needs a separate retry-access decision because its current submission revokes the caller's membership, and the normal authorization middleware will reject a later replay. This helper does not grant access to retained results.
