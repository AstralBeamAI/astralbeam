# Database package

`@astralbeam/db` owns the PostgreSQL client, Drizzle schema, and migrations. Keep consumer documentation in `README.md` and author guidance here.

## Boundaries

- Keep the runtime client in `src/index.ts` and preserve its `@tanstack/react-start/server-only` marker.
- Never import the runtime entrypoint into browser code.
- Keep tables and relations under `src/schema/` and re-export every model Drizzle Kit must discover from `src/schema/index.ts`.
- Keep schema modules independent of runtime drivers and Effect.
- Read `DATABASE_URL` from the environment; do not add package-local environment files or credentials.
- Reuse one production connection pool. Keep Postgres.js prepared statements enabled unless the selected pooler explicitly does not support them.
- Keep `drizzle-orm` and `drizzle-kit` pinned to the same exact Drizzle 1.0 release.

## Drizzle configuration

- Keep `drizzle.config.ts` minimal: PostgreSQL dialect, the schema barrel, package-owned `migrations/`, and `DATABASE_URL`.
- Do not add a standard PostgreSQL `driver`; Drizzle Kit selects it from the dialect and installed package.
- Do not add the removed `strict` option. Request verbose output only for commands that need it.

## Schema changes

- Keep one domain concern per schema module and use explicit PostgreSQL column names.
- Do not add placeholder tables or migrations.
- Use Drizzle 1.0 `defineRelations(...)`. Export relation configuration from the schema package and pass `{ relations }` to each runtime driver; do not use the Drizzle 0.x `{ schema }` runtime option.

## Migrations

The TypeScript schema is the source of truth. Generate, review, and commit migrations:

```sh
vp run @astralbeam/db#db generate --name=<descriptive-name>
vp run @astralbeam/db#db check
vp run @astralbeam/db#db migrate
```

- Resolve rename prompts carefully and inspect every generated SQL statement.
- Commit the schema, SQL, and Drizzle snapshot metadata together.
- Treat snapshots as Drizzle-owned state. Never rewrite a migration that has reached a shared environment; create a new migration.
- Use `generate --custom --name=<name>` for data migrations or unsupported DDL.
- Do not use `--ignore-conflicts` without linking a confirmed Drizzle Kit bug.
- Use `push --explain` only with disposable local data. Never use `push --force` against shared data.
- In Drizzle 1.0, `push` and `pull` manage all PostgreSQL schemas by default; use `schemaFilter` or a dedicated database when other schemas are present.
- Keep migrations in normal repository formatting. Review SQL separately because Oxfmt does not format it.

## Effect 4 integration

When adopting Effect 4:

- Follow the current official Drizzle Effect PostgreSQL guide and verify published peer ranges before selecting exact versions.
- Use `drizzle-orm/effect-postgres` with `@effect/sql-pg`; add `@effect/sql-drizzle` only if its published peer ranges support the selected Effect and Drizzle versions.
- Replace the Postgres.js pool rather than running a second production pool.
- Provide one application-owned `Layer`, read the connection string with `Config.redacted`, and let Drizzle parse raw PostgreSQL date and time values.
- Preserve Drizzle's typed query errors until a repository boundary maps them to domain errors.
- Use the native Effect transaction API and run the Effect runtime only at an application boundary.
- Keep Drizzle Kit as the only migration-history owner.

## Validation

Run from the repository root:

```sh
vp run @astralbeam/db#db generate
vp run @astralbeam/db#db check
vp run check
vp run test
vp run build
git diff --check
```

Inspect the complete diff after generation. After changing the runtime driver, also run a live PostgreSQL smoke query and close the client.

## Official references

- [PostgreSQL drivers](https://orm.drizzle.team/docs/get-started-postgresql)
- [Drizzle Kit configuration](https://orm.drizzle.team/docs/drizzle-config-file)
- [Migration workflows](https://orm.drizzle.team/docs/migrations)
- [Drizzle Effect PostgreSQL](https://orm.drizzle.team/docs/connect-effect-postgres)
