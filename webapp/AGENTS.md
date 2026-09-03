## Codebase Structure and Guidelines

- Use plain data and helper functions with explicit options objects for application logic; do not use classes or closure-based state factories. Isolate framework-required classes such as React error boundaries.
- Keep named functions, function-valued variables, and module-level constants globally unique within `webapp`; use concise domain qualifiers when needed. Implementations may reuse names prescribed by their shared interface, as may framework-mandated exports such as TanStack Router's `Route`.
- Remember that the webapp is also distributed as a deno binary. So don't implement anything in a way that breaks the binary-distribution flow.

- This is TanStack Start React app
  - Tech stack: TanStack Router, Tailwind, Shadcn UI, Better Auth, Drizzle ORM, React Email
  - `deno` is the runtime and package manager, all useful commands are listed in `package.json`
  - all the application code lives in `src/`
  - custom scripts are placed in `scripts/`, and invoked using `package.json` commands
- Run Oxlint only through Deno tasks; do not install or invoke Node, npm, or npx, or directly declare, configure, or invoke ESLint. Transitive ESLint peer lock entries are acceptable.
- Preserve imported lint preset rules, options, and severities with one owner for overlaps; keep legacy findings in file-scoped TODOs with diagnostic and distinct-file counts.
- When updating Oxlint or plugin lock entries, re-audit imported presets, recheck every linked compatibility issue, and smoke-test all plugin loaders.

- `src/components/ui` contains registry-generated shadcn UI components. Keep it excluded from Oxlint, Deno lint, formatting, and automatic fixes; make only intentional integration edits and record every divergence in the file's provenance header.
  - Add new components only with `deno task ui add <component>`.
  - Better Auth UI output under `src/components/auth` and `src/lib/auth`, and Emailcn output under `src/emails`, follow the same provenance rule: retain the registry command, source, and local changes; preserve earlier provenance when replacing a source and centralize shared email changes outside imported templates.
  - Let Knip delete unreachable registry files, while suppressing only generated export-level noise.
- `src/components` contains other common components used throught the application
  - build components using the proper shadcn-ui primitives, instead of raw HTML elements
  - always use icons from the configured icon library in `components.json`
  - Every icon-only interactive control needs an accessible name and a hover explanation; pair `aria-label` with `title` unless the interaction specifically needs richer shadcn Tooltip content.
  - Keep single-use private UI states, skeletons, and rows in their sole consumer module unless reuse or substantial complexity justifies a separate file.

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
  - Keep `/dev` utilities synthetic and development-only; they must return `404` in production.
  - Related routes can sometimes be grouped together using a route group folder e.g. `(auth)` if it better structures the codebase

- `src/db` contains the database schema and migrations
  - The server-only guarded `src/db/index.ts` entry point exports the Promise Drizzle handle and the native Effect database service; import both through `@/db`. Share its single application `pg.Pool` with `drizzle-orm/effect-postgres` through `PgClient.fromPool` and one `ManagedRuntime`, while keeping Better Auth on the Promise handle and native Effect workflows behind the one framework bridge. Keep node-postgres pool lifecycle defaults; do not add `allowExitOnIdle`, a parallel pool, global PostgreSQL type-parser table, or Nitro/signal lifecycle plumbing. The migration runner holds its advisory lock and per-migration transactions on separate clients from this shared pool.
  - `schema.server.ts` contains the drizzle schema
  - Keep generally reusable database primitives in `src/db/lib`; keep table-specific domain interfaces and the migration runner directly under `src/db`.
  - Define shared PostgreSQL columns with `caseInsensitiveText()`, `encryptedJson()`, `timestampWithTimeZone()`, `timestamps()`, `lockVersion()`, `uuidV7()`, and `uuidV7PrimaryKey()` from `src/db/lib/columns.server.ts`; do not inline equivalent Drizzle builders.
  - Drizzle Effect query failures store the Effect SQL error inside an `EffectDrizzleQueryError` Cause; inspect it with Effect's `Cause` utilities and then standard JavaScript `cause` links instead of traversing arbitrary fields or parsing error messages.
  - Keep domain schema definitions in responsibility-named `src/db/schema/*.server.ts` files and re-export every table and relation Drizzle Kit must discover from `schema.server.ts`.
  - Keep every organization-owned table in `src/db/schema/organizations.server.ts` and its relations centralized; first-party organization-owned tables use `uuidV7()` IDs inside composite primary keys, while Better Auth-owned tables retain their upstream-compatible UUIDv7 primary keys.
  - Define tables with `snakeCase.table` and camel-case TypeScript keys so Drizzle derives lower snake-case SQL column names.
  - Every organization-owned table must have a non-null `organizationId`. Use `(organizationId, id)` as the primary key for first-party tables, enforce one-to-one ownership with a unique foreign key, and propagate organization-scoped alternate keys, foreign keys, and unique constraints.
  - Tenant-owned tables must retain their own UUIDv7 ID, carry `organizationId` and `tenantId`, use all three columns as the primary key, and propagate composite organization/tenant foreign keys and unique constraints.
  - Better Auth's `member` and `invitation` tables are exceptions only to composite organization-scoped foreign keys; they still require UUIDv7 IDs and `organizationId` foreign keys. Obtain architectural approval for other exceptions.
  - Both audit columns use `DEFAULT now()`; Drizzle's `updatedAt` `$onUpdateFn` hook returns PostgreSQL `now()` but does not create a database trigger, so non-Drizzle updates must set `updated_at` explicitly.
  - Define optimistic locks with `lockVersion()`, use `updateWithOptimisticLock` or `deleteWithOptimisticLock`, and map expected conflicts with `catchOptimisticLockConflict` instead of branching on error reasons at each caller; do not add `$onUpdateFn` or a redundant check constraint.
  - Store encrypted database values only through the strict Compact JWE helpers in `src/db/lib`. Required `DATABASE_ENCRYPTION_KEY` entries contain at least 32 characters: the first encrypts and the rest decrypt older values. Never treat malformed or unreadable JWE as plaintext, write during reads, log stored values, or expose them outside an explicitly authorized, no-store configuration flow. Include dynamic row identity inside the encrypted payload and compare it with sibling columns after decoding. Keep tenant-bound encrypted row access behind small table-specific functions. Use `src/db/config.server.ts` for validated reads and writes to the encrypted `config.value` column and `getGlobalConfig` for environment precedence and process caching; keep deployment settings global, organization settings authorized and organization-scoped, and use migrations instead of preemptive settings-schema version columns.
  - Surface sandbox provider configuration through the owner-and-developer `/organization/sandbox-providers` sidebar entry and gate it by its exact Better Auth permission; keep every read and mutation protected independently at the server boundary because sidebar visibility is not authorization, mark authenticated configuration responses `Cache-Control: no-store`, and disable route preloading, cached loader retention, and stale rendering before returning decrypted credentials for masked editing.
  - Creating an organization also creates its starter agent (slug `assistant`, named after the organization) and the `organization_configuration` row whose `default_agent_id` points at it, so `/api/chat` can resolve an agent for a host that sends no `agentId`. Keep an agent's sandbox provider optional, because a provider cannot be saved before its connection test passes, and keep `default_agent_id` behind the composite organization-scoped reference, releasing it in the same transaction that deletes the agent it points at.
  - Model independently usable organization integration instances as separate named rows, using `citext` when names must be case-insensitively unique. Keep provider IDs in a closed registry with shared Effect schemas and reject unknown or provider-mismatched fields before storage or return.
  - Preserve required extension DDL such as `CREATE EXTENSION IF NOT EXISTS citext` when regenerating an unmerged migration.
  - `migrations` contains the drizzle migrations

- `src/lib` contains application-wide shared code like:
  - `schemas.ts`: reusable domain-neutral Effect schemas; reuse its UUIDv7 and lock-version schemas instead of duplicating their predicates.
  - Keep `src/lib/slug.ts` resource-agnostic: it owns the shared slug policy and suggestion generation, while public-ID structure and database lookup or creation stay at each resource boundary or repository.
  - `utils.ts`: utility functions
  - `utils.server.ts`: server-only utilities
  - `src/lib/config/index.ts` is guarded as server-only and exports `getGlobalConfig(key)` with environment precedence and process-local caching. Keep definitions and validation in `src/lib/config`, while the Drizzle `config.value` codec owns JWE encryption and `src/db/config.server.ts` owns validation and unreadable-row recovery. `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are required; uppercase registry environment overrides take precedence and stay out of database reads and `/configure`, same-process writes invalidate the cache, and errors never include configuration values.
  - `constants.ts`: constant values readable from both server and client
  - `types.ts`: common types used across the application, including the config registry types and `PublicConfig`, the secret-free config slice
  - `auth.server.ts` contains the server-only Better Auth setup for authentication
  - Avoid creating new files in `src/lib`; new shared code normally belongs in one of the files above or in a module-specific `-lib` folder. `src/lib/sandbox` is an approved cohesive exception because it is a package boundary intended for later extraction; its package-facing modules must not import webapp configuration, authentication, database, route, or UI modules.
  - Before writing or extending a sandbox provider adapter, check current TanStack AI provider packages, open pull requests and issues, npm, and the vendor SDK. Prefer a maintained TanStack adapter, use the official vendor SDK directly when none exists, and link the exact upstream source or missing behavior beside unavoidable custom lifecycle code; do not insert a second generic sandbox abstraction unless it conforms to the TanStack contract.

- `src/emails` contains emails powered by react-email
  - `index.ts` exports `sendEmail` plus one `send<Template>Email` wrapper per template, each owning its own subject and props
  - Preserve imported templates' native prop contracts where practical; map Better Auth data in `index.ts`, co-locate each typed preview-props factory at the bottom of its template, and preview with synthetic props at `/dev/emails`
  - `sendEmail` loads only the selected `providers/*.ts` module, through a static map of dynamic imports
  - `provider`, `from`, and `replyTo` default to the `email_provider` and `email_from_address` config values and the resolved `from`
  - `email_from_address` is validated for shape in the config registry, because Resend and SES accept only `email@example.com` or `Name <email@example.com>` and a typo would otherwise fail at send time
  - Keep one SMTP provider and one Nodemailer transport for local, self-hosted, and hosted servers: host, port, and security default to `127.0.0.1`, `1025`, and `none`; `none` disables TLS, `auto` uses STARTTLS when advertised, `starttls` requires STARTTLS, `tls` starts with TLS, and username/password must be supplied together or both omitted. Do not add product-specific SMTP providers, queues, retries, DKIM, OAuth, pooling, bounce handling, certificate controls, cipher controls, or TLS-version controls without explicit product scope
  - Templates cannot resolve relative paths, so build absolute URLs from the configured `app_base_url`; attachment `path` is a URL, a `data:` URI, or bare base64

- `/configure` (`src/routes/configure`) is the operator surface for database-backed config. If the login limiter table is missing, render sign-in without throttling. Authenticate short, stateless sessions only with the first active `DATABASE_ENCRYPTION_KEY` value; never use database credentials. Require production HTTPS and same-origin mutations, and trust forwarded host/protocol only when ingress overwrites them and blocks direct origin access. Mask values until explicitly revealed, approve migrations by exact name and digest, and derive the app gate from process-cached configuration validity and migration state rather than a persisted completion marker.

- `/api/chat` (`src/routes/api/chat`) is the SDK chat widget's cross-origin endpoint, and it serves authenticated tenant users only: a request whose bearer token is missing or invalid is answered with `401`, since every run bills provider tokens to one shared deployment. Restore guest runs only with explicit approval and an abuse budget. Enforce authenticated tenant-user limits in the database; protect unauthenticated request volume at ingress with a trusted client address rather than an attacker-controlled forwarded header or an unbounded process map. It owns model-capability handling for attachments: `-lib/attachments.server.ts` rewrites every user message before the run so images and PDFs pass through as provider file inputs, text files are decoded into labeled text, and anything else (audio, video, a URL source, an oversized or non-UTF-8 file) becomes a sentence the agent can relay — the provider adapter throws on a part it cannot map, which would otherwise fail the whole run. Keep its caps in `-lib/constants.server.ts` in step with the SDK composer's, enforce them here regardless of what the client sent, and keep attachment payloads out of logs and errors. It also owns sandbox execution: an agent with a sandbox provider selected gets the server-side tools in `-lib/sandbox-tools.server.ts`, whose lifecycle lives in `-lib/sandbox.server.ts` and whose behavior is documented in `src/lib/sandbox/README.md`. Provision lazily on first tool use rather than per run, scope every sandbox lookup by the authenticated organization, tenant, and tenant user rather than by the browser-supplied thread alone, bound every provider call and cap every output that reaches the model, return a refusal or an exit code to the agent instead of throwing, and never let a vendor error message reach the client. Published sandbox artifacts are served by `/api/chat/files` from a short-lived ticket signed with a key HKDF-derived from the deployment encryption root under its own info label (deployment-wide so any replica can verify, domain-separated, and never the stored API-key digest), bound to a SHA-256 of the published bytes: resume the sandbox by provider id only (never create), then re-read, re-sniff by magic bytes, re-cap, and re-hash at serve time, render inline only sniffed raster images, and keep SVG forever `text/plain` with `nosniff` and a script-free CSP.

- Authentication uses Better Auth with verified email/password, Google, GitHub, and Organizations. Keep username, passwordless, OTP, magic-link, change-email, account deletion, organization deletion, teams, and dynamic roles disabled unless product scope changes. The Better Auth instance is built per config snapshot through `getAuth()`; Google and GitHub are enabled only when both of a provider's config credentials are set.
  - Require both Turnstile keys before setup can complete and integrate through Better Auth's server plugin and Better Auth UI's CAPTCHA contribution so the UI library owns token headers and single-use resets; application forms may read `x-captcha-response` only to disable submission until an active CAPTCHA is ready.
  - Use `user` only for the global authenticated identity, `account` for a credential or OAuth connection, `organization` for the SaaS boundary, and `member` for a user's relationship to an organization. Name organization-management routes, files, navigation, and visible copy “Members”; do not use “People” or “Workspace” as synonyms.
  - Keep `termsAcceptedAt` server-owned. When any legal policy URL is configured, require explicit legal acceptance for credential and OAuth signup; when none is configured, do not display or record acceptance. Disable implicit OAuth signup, and accept provider identities or invitations only after verified-email checks.
  - Keep OAuth tokens encrypted, account linking restricted to matching verified emails, unlinking the final sign-in method disabled, session cookie caching disabled, and rate limits in the database.
  - Authentication email delivery must fail the request the user is waiting on: keep `advanced.backgroundTasks` unset, wrap every blocking send in `deliverBlockingAuthEmail`, and keep `assertAuthEmailDelivered()` first in the `after` hook, because Better Auth's `runInBackgroundOrAwait` swallows a send rejection. Read `src/lib/auth/AGENTS.md` before changing an authentication email path: it records what each flow leaves behind on a failed send, the duplicate-signup and pending-invitation recovery paths, and the enumeration trade-offs that depend on both sign-up branches sending exactly one email.
  - Log every authentication send outcome once, in `deliverAuthEmail`, with a recipient masked by `maskEmailAddressForLog` and the provider's reason on failure; never log the rendered email or a token URL, and never return the provider's reason to a client. Give any new unauthenticated path that sends to a caller-supplied address its own `rateLimit.customRules` bucket.
  - Keep `tanstackStartCookies()` last in the server plugin list. Route guards are navigation UX; every Better Auth API or server function must independently enforce its session, fresh-session, organization, and role requirements.
  - Configure organization roles through Better Auth's static server/client role maps and hooks: creators are owners, invitations initially select viewer, owner/developer/viewer roles are composable, viewer and developer share the Better Auth member access statement, and roles outside the configured map are rejected. Keep dynamic roles disabled.
  - Put organization API keys at the dedicated `/organization/api-keys` sidebar destination and gate it by its exact Better Auth permission; page and sidebar visibility are navigation UX, not authorization. Keep organization API key names required and server-trimmed, force the `abo_` prefix, default expiration to Never, use a limit of 100 requests per 5 minutes, grant API-key actions only to owners and developers, and neither render nor fetch or list keys for viewers. Map the plugin model to `api_key` and its generic `referenceId` field to `organizationId` so the organization relationship remains explicit in application schema. `/api/chat` is the narrow exception to Better Auth's raw-key verifier: verify its short-lived JWT with `jose` against the stored Better Auth digest because the raw API key is absent, derive organization context from the loaded row, and never consume quota, rate-limit, refill, or `lastRequest` state during JWT validation. The direct-digest signing design makes database read access sufficient to forge chat JWTs; treat it as a signing-key boundary. Never expose the bearer secret to browser code or enable [`enableSessionForAPIKeys`](https://better-auth.com/docs/plugins/api-key/advanced#sessions-from-api-keys), which only supports user-owned keys and is not recommended for this organization-owned credential.
  - Validate organization-issued SDK tokens against the platform `astralbeam` audience without feature scopes; treat `kid` as a lookup hint until the organization-owned key, signature, lifecycle, issuer, and audience are verified, and do not require the optional JWT subject.
  - Carry the required organization slug from the database-backed session decision through route context and require it on organization-scoped component props; do not refetch the active organization or make public-ID rendering conditional on a missing slug.
  - Configure authentication plugins only with product-specific overrides; rely on Better Auth defaults and TanStack response headers when they already satisfy the requirement.

- Use parameterized TanStack function middleware to share repeated authorization and trusted context. Keep resource server functions explicit when their validators, permissions, errors, or result contracts differ; do not add a parallel Effect HTTP/RPC transport merely to hide small wrappers.
- Prefer supported framework or library APIs and well-maintained community packages over minor custom abstractions or bespoke integration plumbing.
- Write new server-side application logic as Effect programs with typed failures; yield native Effect integrations directly, lift unavoidable Promise APIs with `Effect.tryPromise`, and run Effects only at framework boundaries.
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
  - Put server-only code in `*.server.ts` files and rely on that suffix as the guard; use `import "@tanstack/react-start/server-only"` only when an unsuffixed entry point such as `index.ts` must remain server-only. Never expose server environment variables to the client.

TODO: add common commands
