## Codebase Structure and Guidelines

- Use plain data and helper functions with explicit options objects for application logic; do not use classes or closure-based state factories. Isolate framework-required classes such as React error boundaries.
- Keep named functions, function-valued variables, and module-level constants globally unique within `webapp`; use concise domain qualifiers when needed, while retaining framework-mandated names such as TanStack Router's `Route` export.

- This is TanStack Start React app
  - Tech stack: TanStack Router, Tailwind, Shadcn UI, Better Auth, Drizzle ORM, React Email
  - `deno` is the runtime and package manager, all useful commands are listed in `package.json`
  - all the application code lives in `src/`
  - custom scripts are placed in `scripts/`, and invoked using `package.json` commands

- `src/components/ui` contains registry-generated shadcn UI components and remains excluded from formatting; make only intentional integration edits and record every divergence in the file's provenance header.
  - Add new components only with `deno task ui add <component>`.
  - Better Auth UI registry output under `src/components/auth`, `src/lib/auth`, and `src/emails` follows the same provenance rule: record the top-level `deno task ui add` command and every intentional local change.
  - Let Knip delete unreachable registry files, while suppressing only generated export-level noise.
- `src/components` contains other common components used throught the application
  - build components using the proper shadcn-ui primitives, instead of raw HTML elements
  - always use icons from the configured icon library in `components.json`
  - Every icon-only interactive control needs an accessible name and a hover explanation; pair `aria-label` with `title` unless the interaction specifically needs richer shadcn Tooltip content.

- `src/routes` contains routes, as expected by TanStack Router:
  - Prefer `routes/my/route/path/index.ts/tsx` to `route/my/route/path.ts/tsx` in general for better code organization
  - Prefer folder based route structuring (a/b/c.tsx) over flat routes (a.b.c.tsx) unless there's good reason not to
    - Good reasons: avoiding very deep nesting, organizing related routes together
  - Routes which render web pages typically contain:
    - A `Route` export that uses `createFileRoute` and specifies a `component`
    - The route typically also contain `loader`, `pendingComponent` and somtimes `beforeLoad`
    - The main component which renders the page (typically `XYZPage`) defined below the route
    - The pending component (typically `XYZPageSkeleton`) show a skeleton UI matching page layout
    - The loader might typically invoke a server function (e.g. `loadXYZPageData`) to load the data for the page.
    - The main component might typically use import and use other react components
    - The main component (or the components it uses) can use server functions for mutations (e.g. `updateXYZ`)
  - A route file may have the following folders next to it for colocation of logic:
    - `-components`: Contains components used only in that route file
      - one component per file, use normal exports (not default)
      - name `my-custom-component.tsx` for `<MyCustomComoponent />`
    - `-functions`: Contains server functions used only in that route file
      - one server function per file, with proper middleware & authorization check
      - use the proper HTTTP method (GET or POST or DELETE) depending on what the server function does
      - name `update-xyz-data` for the function `updateXYZData` normal export (not default)
      - validate server functions using `.validator` with an Effect schema exposed through `Schema.toStandardSchemaV1`; do not introduce Zod
    - `-lib`: Contains helper functions `utils.ts`, database queries `db.ts` specific to the route
      - Keep route-local utilities in `utils.ts` and `utils.server.ts` by default. When a cohesive group of related utilities grows beyond roughly 100 lines, place it in a responsibility-named file under `-lib` to keep the general utility files focused.
      - Always put constants in a `constants.ts` or `constants.server.ts` files
      - each function in `-lib/db.ts` should typically wrap one db query / transaction and return its result
      - `-lib/types.ts` can contain any types specif to the route.
  - If multiple routes use the same component/function/helper, lift it up to the closest common ancestor
    - Exception: somtimes when one route _SHOULD OWN_ a component/function used elsewhere, keep it close to the route
  - Routes might someimtes be layout routes and may render an `<Outlet />` which then renders the child routes
    - Avoid heavy layout nesting, do it only when it makes sense.
    - For layout routes, somtimes it's better to avoid the `index.tsx` file in `my/route/path/index.ts/tsx` (use your judgement)
    - Key the organization layout outlet by the active organization ID so a successful switch resets organization-scoped UI; do not reset it while a switch is pending.
  - Routes that do not render pages might be server routes (`createFileRoute({ server ... }))`
    - The are typically place in the `routes/api` folder unless there's a strong reason to have them outside.
  - Related routes can sometimes be grouped together using a route group folder e.g. `(auth)` if it better structures the codebase

- `src/db` contains the database schema and migrations
  - `index.server.ts` contains the databse connection and drizzle db object
  - `schema.server.ts` contains the drizzle schema
  - Keep generally reusable database primitives in `src/db/lib`; keep table-specific domain interfaces and the migration runner directly under `src/db`.
  - Keep domain schema definitions in responsibility-named `src/db/schema/*.server.ts` files and re-export every table and relation Drizzle Kit must discover from `schema.server.ts`.
  - Keep every organization-owned table in `src/db/schema/organizations.server.ts` and its relations centralized; every table must define its own `id: uuidV7PrimaryKey()`, including one-to-one, join, and third-party-managed tables.
  - Define tables with `snakeCase.table` and camel-case TypeScript keys so Drizzle derives lower snake-case SQL column names.
  - Every organization-owned table must have a non-null `organizationId`. Keep `id` as its primary key, enforce one-to-one ownership with a unique foreign key, and propagate organization-scoped alternate keys, foreign keys, and unique constraints.
  - Tenant-owned tables must retain their own UUIDv7 primary key, carry `organizationId` and `tenantId`, and propagate composite organization/tenant foreign keys and unique constraints.
  - Better Auth's `member` and `invitation` tables are exceptions only to composite organization-scoped foreign keys; they still require UUIDv7 IDs and `organizationId` foreign keys. Obtain architectural approval for other exceptions.
  - Both audit columns use `DEFAULT now()`; Drizzle's `updatedAt` `$onUpdateFn` hook returns PostgreSQL `now()` but does not create a database trigger, so non-Drizzle updates must set `updated_at` explicitly.
  - Define optimistic locks with `lockVersion()` and use `updateWithOptimisticLock` or `deleteWithOptimisticLock`; do not add `$onUpdateFn` or a redundant check constraint.
  - Store encrypted database values only through the strict Compact JWE helpers in `src/db/lib`. Required `DATABASE_ENCRYPTION_KEY` entries contain at least 32 characters: the first encrypts and the rest decrypt older values. Never treat malformed or unreadable JWE as plaintext, write during reads, log stored values, or expose them outside the authenticated, no-store `/configure` flow. Include dynamic row identity inside the encrypted payload and compare it with sibling columns after decoding. Keep tenant-bound encrypted row access behind small table-specific functions. Use `src/db/config.server.ts` for validated reads and writes to the encrypted `config.value` column and `getGlobalConfig` for environment precedence and process caching; keep deployment settings global, organization settings authorized and organization-scoped, and use migrations instead of preemptive settings-schema version columns.
  - Preserve required extension DDL such as `CREATE EXTENSION IF NOT EXISTS citext` when regenerating an unmerged migration.
  - `migrations` contains the drizzle migrations

- `src/lib` contains application-wide shared code like:
  - `utils.ts`: utility functions
  - `utils.server.ts`: server-only utilities
  - `src/lib/config/index.ts` is guarded as server-only and exports `getGlobalConfig(key)` with environment precedence and process-local caching. Keep definitions and validation in `src/lib/config`, while the Drizzle `config.value` codec owns JWE encryption and `src/db/config.server.ts` owns validation and unreadable-row recovery. `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are required, uppercase registry environment overrides take precedence and stay out of database reads and `/configure`, same-process writes invalidate the cache, and errors never include configuration values.
  - `constants.ts`: constant values readable from both server and client
  - `types.ts`: common types used across the application, including the config registry types and `PublicConfig`, the secret-free config slice
  - `auth.server.ts` contains the server-only Better Auth setup for authentication
  - avoid creating new files in `src/lib`, use new code goes into one of the above files or into a module-specific `-lib` folder.

- `src/emails` contains emails powered by react-email
  - `index.ts` exports `sendEmail` plus one `send<Template>Email` wrapper per template, each owning its own subject and props
  - `sendEmail` loads only the selected `providers/*.ts` module, through a static map of dynamic imports
  - `provider`, `from`, and `replyTo` default to the `email_provider` and `email_from_address` config values and the resolved `from`
  - Templates cannot resolve relative paths, so build absolute URLs from the configured `app_base_url`; attachment `path` is a URL, a `data:` URI, or bare base64
  - Preview with `deno task email`, which runs a server as configured in `scripts/preview-emails.ts`

- `/configure` (`src/routes/configure`) is the operator surface for database-backed config. Authenticate short, stateless sessions only with the first active `DATABASE_ENCRYPTION_KEY` value; never use database credentials. Require production HTTPS and same-origin mutations, and trust forwarded host/protocol only when ingress overwrites them and blocks direct origin access. Mask values until the operator explicitly reveals them, approve migrations by exact name and digest, and derive the app gate from process-cached configuration validity and migration state rather than a persisted completion marker.

- `/api/chat` (`src/routes/api/chat`) is the SDK chat widget's cross-origin endpoint, and it serves signed-in users only: a request whose bearer token is missing or invalid is answered with `401`, since every run bills provider tokens to one shared deployment. Restore guest runs only with explicit approval and an abuse budget. It owns model-capability handling for attachments: `-lib/attachments.server.ts` rewrites every user message before the run so images and PDFs pass through as provider file inputs, text files are decoded into labeled text, and anything else (audio, video, a URL source, an oversized or non-UTF-8 file) becomes a sentence the agent can relay — the provider adapter throws on a part it cannot map, which would otherwise fail the whole run. Keep its caps in `-lib/constants.server.ts` in step with the SDK composer's, enforce them here regardless of what the client sent, and keep attachment payloads out of logs and errors.

- Authentication uses Better Auth with verified email/password, Google, GitHub, and Organizations. Keep username, passwordless, OTP, magic-link, change-email, account deletion, organization deletion, teams, and dynamic roles disabled unless product scope changes. The Better Auth instance is built per config snapshot through `getAuth()`; Google and GitHub are enabled only when both of a provider's config credentials are set.
  - Require both Turnstile keys before setup can complete and integrate through Better Auth's server plugin and Better Auth UI's CAPTCHA contribution so the UI library owns token headers and single-use resets; application forms may read `x-captcha-response` only to disable submission until an active CAPTCHA is ready.
  - Use `user` only for the global authenticated identity, `account` for a credential or OAuth connection, `organization` for the SaaS boundary, and `member` for a user's relationship to an organization. Name organization-management routes, files, navigation, and visible copy “Members”; do not use “People” or “Workspace” as synonyms.
  - Keep `termsAcceptedAt` server-owned. When any legal policy URL is configured, require explicit legal acceptance for credential and OAuth signup; when none is configured, do not display or record acceptance. Disable implicit OAuth signup, and accept provider identities or invitations only after verified-email checks.
  - Keep OAuth tokens encrypted, account linking restricted to matching verified emails, unlinking the final sign-in method disabled, session cookie caching disabled, and rate limits in the database.
  - Keep `tanstackStartCookies()` last in the server plugin list. Route guards are navigation UX; every Better Auth API or server function must independently enforce its session, fresh-session, organization, and role requirements.
  - Configure organization roles through Better Auth's static server/client role maps and hooks: creators are owners, invitations initially select viewer, owner/developer/viewer roles are composable, viewer and developer share the Better Auth member access statement, and roles outside the configured map are rejected. Keep dynamic roles disabled.

- Server functions and server routes should generally be guarded by middleware e.g. authMiddleware unless there's strong reason not to
- Write new server-side application logic as Effect programs with typed failures; lift Promise APIs with `Effect.tryPromise` and run Effects only at framework boundaries.
- Generate Effect validation schemas from Drizzle tables with the built-in [`drizzle-orm/effect-schema`](https://orm.drizzle.team/docs/effect-schema) helpers at database and API boundaries instead of duplicating table shapes by hand.

- While writing DB queries, always put in the right authorization checks to avoid leaking one user/org's data to another

- Keep only tests that protect durable behavior, security boundaries, or regressions; avoid trivial assertions over constants, generated files, and implementation structure.
- Always write and run tests with Vitest through `deno task test`; never use `Deno.test` or `deno test`.
- Keep new functions at cyclomatic complexity 20 or lower and do not increase higher legacy functions; extract focused helpers instead of suppressing the complexity finding.
- Keep the root `ThemeProvider` around the document content so its SSR startup script applies the persisted or system theme before first paint; do not defer initial theme application to a post-hydration effect.

- After every major change, look for opportunities to reuse or refactor code (components, server functions, db queries etc.)
  - in general, as more patterns emerge across routes/modules, lift up the reusable code to common ancestors
  - be especially careful with types, it is very easy to end up with heavy type duplication with minor changes

- Never hardcode the word "AstralBeam" or any AstralBeam-specific description or nomenclature anywhere in the app; assume it may be white-labeled.
  - Put labels and constants in `src/lib/constants.ts` and import them elsewhere so changes stay centralized.
  - Use `APP_NAME` for display text and `APP_HANDLE` for brand-derived domains, protocol identifiers, asset paths, and test fixtures.

- IMPORTANT SECURITY CHECKS after implementing new features:
  - In `beforeLoad` you might need to check if the page is actually accessible to the curent user
  - In every server function, you might need to check if the current user is authorized to access & update the data
  - In every databsae query, you might need to ensures that the right filters are applied to avoid leaking data accidentally
  - Errors in the backend must be handled, logged and gracefully shown to a user to convey why something didn't work without leaking critical info that might compromise the application security.
  - Server-only code should typically go into `*.server.ts` files (except `index.ts` files where you can use a "server-only" import from TanStack Start as the guard). be careful not to leak server environment vars into the client.

TODO: add common commands
