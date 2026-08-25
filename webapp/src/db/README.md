# Webapp database

The Webapp owns its server-only PostgreSQL client, Drizzle schema, and generated migrations in this directory.

## Structure

- `index.server.ts` creates and exports the Drizzle client.
- `schema.server.ts` is the schema entrypoint and re-exports every table and relation Drizzle Kit must discover.
- `schema/` contains responsibility-named domain table and relation modules.
- `migrations/` contains generated migration SQL and Drizzle snapshots.

`schema/tables.server.ts` is the table-only namespace shared by Drizzle and adapters. `schema/relations.server.ts` creates the base relation definition, adds Better Auth's generated-shape relation part, and exports the single composition root passed to `drizzle()`.

## Query from server-only code

Once a table is exported from the schema entrypoint, consume it with the Drizzle client:

```ts
import { db } from "@/db/index.server"
import { projects } from "@/db/schema.server"

export const listProjects = () => db.select().from(projects)
```

Both imports belong in server-only code and require `DATABASE_URL`.

## Local services

Start PostgreSQL and Valkey from the repository root before commands that connect to PostgreSQL. Podman supplies the Docker-compatible command used here:

```sh
docker compose up --detach --wait
```

## Database commands

Run Drizzle commands from `webapp`. Apply every checked-in migration that has not yet run against the configured database:

```sh
deno task db migrate
```

After changing the TypeScript schema, generate a named migration, inspect its SQL and snapshot, verify migration-history consistency, then apply it:

```sh
deno task db generate --name=add-projects
deno task db check
deno task db migrate
```

Reset only the disposable local PostgreSQL database from the repository root without installing PostgreSQL tools on the host, then reapply all checked-in migrations:

```sh
docker compose exec postgres sh -ceu 'dropdb --if-exists --force --username "$POSTGRES_USER" "$POSTGRES_DB"; createdb --username "$POSTGRES_USER" "$POSTGRES_DB"'
cd webapp
deno task db migrate
```

To remove all local PostgreSQL and Valkey data instead, recreate both named volumes from the repository root:

```sh
docker compose down --volumes
docker compose up --detach --wait
cd webapp
deno task db migrate
```

Both reset workflows are destructive and must only be used for disposable local data. `migrate` applies pending checked-in migrations; `check` validates migration-history consistency and does not inspect which migrations a live database has applied.

## Drizzle migration workflow

Drizzle is schema-first: `src/db/schema.server.ts` is the hand-authored schema entrypoint, and `generate` compares it with the latest existing Drizzle snapshot rather than the live database. Out-of-band database changes are therefore invisible to generation.

Each generated `src/db/migrations/<timestamp>_<name>/` directory is one migration unit:

- `migration.sql` is the forward SQL that `migrate` executes and records in the database migration log.
- `snapshot.json` is Drizzle Kit-owned metadata describing the complete Drizzle-managed schema after that migration and its place in migration history. PostgreSQL never executes it, and it is not a database or data backup.

Review the SQL and commit it with its matching snapshot and TypeScript schema change. Do not edit snapshots by hand.

## Relations v2 composition

The relation composition root always spreads `baseRelations` first and then each responsibility-named relation part. Better Auth core and its organization plugin remain together in the generated-shape `authRelations` part.

When adding a domain such as billing or projects:

1. Add its tables to a responsibility-named schema module and re-export them from `schema/tables.server.ts`.
2. Define one relation part, such as `billingRelations`, with `defineRelationsPart(schema, ...)`.
3. Spread that part after `baseRelations` in `databaseRelations`.

Each source table must be owned by exactly one relation part. Two parts defining the same source table would allow a later object spread to silently replace relationships from the earlier part. See Drizzle's [Relations v2 part ordering](https://orm.drizzle.team/docs/relations#relations-parts).

- This workflow has no automatic rollback command; reverse an applied change with another forward migration, and never rewrite migration history that may have reached a shared environment.
- Resolve rename prompts carefully because a mistaken answer can produce destructive drop-and-create SQL.
- Schema diffs cannot infer data backfills or transformations. Use `deno task db generate --custom --name=backfill-projects` for data migrations or unsupported DDL.
- `push` compares the TypeScript schema directly with a live database without creating migration files. Keep it to disposable local experiments, use `deno task db push --explain` to preview the SQL, and never use `push --force` against shared data.
- Older Drizzle examples may show root-level SQL files and `meta/_journal.json`; this repository uses Drizzle 1.0's colocated migration format.
- Drizzle's `up` command upgrades migration metadata on disk; it does not apply pending migrations. Use `deno task db migrate` to update a database.
