# Webapp database

The Webapp owns its server-only PostgreSQL client, Drizzle schema, and generated migrations in this directory.

For schema layout, encryption, authorization, and relation composition, follow [Webapp database instructions](../../AGENTS.md#database).

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

Worktree setup copies the primary checkout's ignored `webapp/.env.development.local`, or creates it when absent, and appends a `DATABASE_URL` for that worktree. The database name is the unique worktree folder: for example, Codex worktree `.../worktrees/a3f4/astralbeam` uses database `a3f4`. An exported shell `DATABASE_URL` remains authoritative.

## Database commands

Run these commands from the repository root. Apply every checked-in migration that has not yet run against the configured database:

```sh
deno task --cwd webapp db migrate
```

After changing the TypeScript schema, generate a named migration, inspect its SQL and snapshot, verify migration-history consistency, then apply it:

```sh
deno task --cwd webapp db generate --name=add-projects
deno task --cwd webapp db check
deno task --cwd webapp db migrate
```

From the repository root, drop and recreate only the confirmed-disposable database selected by Drizzle for the current worktree:

```sh
deno task --cwd webapp db-reset
deno task --cwd webapp db migrate
```

`db-reset` only recreates the selected disposable database. Apply migrations separately and never reset shared Compose volumes. Drizzle `check` validates migration-history consistency, not the live database's applied migrations.

## Seed sample data

`deno task --cwd webapp db-seed` fills the current worktree's database with everything a browser or end-to-end check would otherwise create by hand: global configuration, verified accounts, two organizations with members and a pending invitation, agents, organization API keys, Tenants and tenant users, and a Docker sandbox provider. It skips `/configure`, signup, email verification, and API-key creation entirely.

```sh
deno task --cwd webapp db-reset
deno task --cwd webapp db migrate
deno task --cwd webapp db-seed
```

The seed runs in one transaction and can be rerun to restore fixture values. It identifies organizations by UUID and preserves edited URL slugs. It accepts only loopback database hosts because it writes fixed development credentials.

It prints every account with its password, each agent's public ID, each API key's full value, and a ready-to-paste block for `examples/todos/.env`. `scripts/seed/fixtures.ts` is the single source of those values, and `examples/todos/e2e` imports it directly.

Two things the seed deliberately leaves alone. It never writes `openai_api_key`, and it skips any configuration key whose uppercase environment variable is already set, because the environment takes precedence and `/configure` renders those fields read-only. Put the OpenAI key in `webapp/.env.local`, which `scripts/copy-worktree-env.sh` copies into every worktree.

## Drizzle migration workflow

Drizzle is schema-first: `src/db/schema.server.ts` is the hand-authored schema entrypoint, and `generate` compares it with the latest existing Drizzle snapshot rather than the live database. Out-of-band database changes are therefore invisible to generation.

Each generated `src/db/migrations/<timestamp>_<name>/` directory is one migration unit:

- `migration.sql` is the forward SQL that `migrate` executes and records in the database migration log.
- `snapshot.json` is Drizzle Kit-owned metadata describing the complete Drizzle-managed schema after that migration and its place in migration history. PostgreSQL never executes it, and it is not a database or data backup.

Review the SQL and commit it with its matching snapshot and TypeScript schema change. Do not edit snapshots by hand.

- Reverse applied changes with a forward migration. There is no automatic rollback command.
- Resolve rename prompts carefully to avoid accidental drop-and-create SQL.
- Use `deno task --cwd webapp db generate --custom --name=backfill-projects` for data transformations or unsupported DDL.
- `push --explain` previews direct schema synchronization for disposable prototypes. Never use `push --force` against shared data.
- This repository uses colocated migration folders, not root SQL files and `meta/_journal.json`.
- `up` upgrades metadata on disk. `migrate` applies pending migrations to PostgreSQL.
