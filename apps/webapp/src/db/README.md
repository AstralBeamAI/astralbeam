# `@astralbeam/db`

Server-only PostgreSQL access for AstralBeam applications.

## Query from a server function

Once a table is exported from the schema entrypoint, consume it from a server-only module:

```ts
import { db } from "@astralbeam/db"
import { projects } from "@astralbeam/db/schema"
import { createServerFn } from "@tanstack/react-start"

export const listProjects = createServerFn({ method: "GET" }).handler(() =>
  db.select().from(projects),
)
```

`db` is the shared Drizzle client. The schema entrypoint exports the available tables and relations. Both require server-only code and `DATABASE_URL`.

## Database commands

Run database commands from the repository root. Start the containerized services before commands that connect to PostgreSQL:

```sh
podman compose up --detach --wait
```

Apply every checked-in migration that has not yet run against the configured database:

```sh
vp run @astralbeam/webapp#db migrate
```

After changing the TypeScript schema, generate a named migration, inspect its SQL and snapshot, verify migration-history consistency, then apply it:

```sh
vp run @astralbeam/webapp#db generate --name=<descriptive-name>
vp run @astralbeam/webapp#db check
vp run @astralbeam/webapp#db migrate
```

Reset only the disposable local PostgreSQL database without installing PostgreSQL tools on the host, then reapply all checked-in migrations:

```sh
podman compose exec postgres sh -ceu 'dropdb --if-exists --force --username "$POSTGRES_USER" "$POSTGRES_DB"; createdb --username "$POSTGRES_USER" "$POSTGRES_DB"'
vp run @astralbeam/webapp#db migrate
```

To remove all local PostgreSQL and Valkey data instead, recreate both named volumes:

```sh
podman compose down --volumes
podman compose up --detach --wait
vp run @astralbeam/webapp#db migrate
```

Both reset workflows are destructive and must only be used for disposable local data. `migrate` applies pending checked-in migrations; `check` validates migration-history consistency and does not inspect which migrations a live database has applied.
