# `@astralbeam/webapp`

TanStack Start application for the AstralBeam product.

The application owns its complete product stack, dependency lockfile, and project tooling configuration. Repository bootstrap, agent configuration, the development container, and local service orchestration remain at the repository root. The application does not depend on another AstralBeam project.

## Structure

- `public` — approved SVG logo masters, generated PNG variants, and other static files
- `src/components/ui` — shadcn-generated components
- `src/db` — server-only Drizzle client, schema, and migrations
- `src/lib` — application utilities
- `src/styles.css` — Tailwind, fonts, semantic theme mappings, and generated brand variables
- `src/theme` — pure theme compiler, concrete brand definition, schema, and tests

## Theme

The root route links the checked-in `src/styles.css` stylesheet. Its marked generated section applies the light theme through `:root` by default and keeps `.dark` as the only explicit theme class without shipping the Theme resolver in the client bundle.

Organization lookup, persistence, fallback, and request handling belong at the application boundary. Convert organization definitions with the local server-side theme compiler and deliver the selected CSS through the same document-head path.

Generate checked-in logo output from this directory:

```sh
deno task generate:png
```

## Database

Export schema modules from `src/db/schema.server.ts`, then generate and validate migrations from this directory:

```sh
deno task db generate --name=<description>
deno task db check
deno task db migrate
```
