# `@astralbeam/webapp`

TanStack Start application for the AstralBeam product.

The application owns its complete product stack, dependency lockfile, and project tooling configuration. Repository bootstrap, agent configuration, the development container, and local service orchestration remain at the repository root. The application does not depend on another AstralBeam project.

## Structure

- `public` — approved SVG logo masters, generated PNG variants, and other static files
- `src/auth` — browser-safe auth client, redirect policy, terms version, and organization authorization helpers
- `src/components/auth` — Better Auth UI registry components and AstralBeam organization-access extensions
- `src/components/ui` — shadcn-generated components
- `src/db` — server-only Drizzle client, schema, and migrations
- `src/lib` — application utilities
- `src/server` — Better Auth configuration, session functions, organization middleware, and server-only access workflows
- `src/styles.css` — Tailwind, fonts, semantic theme mappings, and generated brand variables
- `src/theme` — pure theme compiler, concrete brand definition, schema, and tests

## Authentication

The app mounts Better Auth at `/api/auth/$`, presents separate Better Auth UI routes for sign-in and terms-gated sign-up, and onboards new users into an organization. Authenticated pages share the responsive SaaS sidebar, and organization routes require both a session and an active membership.

Google and GitHub are the only enabled providers. Implicit OAuth signup, email/password, teams, and organization deletion are disabled. Organization-owned server functions authorize through `organizationMiddleware`; route `beforeLoad` checks only control navigation.

Follow the repository [OAuth setup guide](../SETUP.md#configure-google-and-github-oauth). Local secrets belong in `.env.local`, while reviewed non-secret defaults remain in `.env.development` and `.env.test`.

Better Auth UI and shadcn components are app-local. Add UI components with `deno task ui add <component>` and preserve the registry command and local-change notes at the top of every retained generated file under `src/components/ui`.

## Theme

The root route links the checked-in `src/styles.css` stylesheet. Its marked generated section applies the light theme through `:root` by default and keeps `.dark` as the only explicit theme class without shipping the Theme resolver in the client bundle.

Organization lookup, persistence, fallback, and request handling belong at the application boundary. Convert organization definitions with the local server-side theme compiler and deliver the selected CSS through the same document-head path.

Generate checked-in logo output from this directory:

```sh
deno task generate:png
```

## Database

The PostgreSQL 18 schema includes Better Auth users, sessions, OAuth accounts, organizations, memberships, rate limits, and email-based organization access grants. Relational identifiers use database-generated UUIDv7 values, email identity uses `citext`, and application instants use `timestamp with time zone`. Export schema modules from `src/db/schema.server.ts`, then generate and validate migrations from this directory:

```sh
deno task db generate --name=<description>
deno task db check
deno task db migrate
```
