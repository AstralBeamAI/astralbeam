# Webapp development

- Use plain data and helper functions with explicit options objects for application logic. Do not use classes or closure-based state factories. Isolate framework-required classes such as React error boundaries.
- Keep named functions, function-valued variables, and module-level constants globally unique within `webapp`. Use concise domain qualifiers when needed. Implementations may reuse names prescribed by their shared interface, as may framework-mandated exports such as TanStack Router's `Route`.
- Keep the webapp distributable as a Deno binary, keep compiled npm payloads limited to reachable packages, and explicitly include any runtime-computed import or require that Deno cannot trace. Run `deno task binary:check` for dependency, build, and server changes. CI runs the same out-of-tree smoke check and enforces its 200 MiB ceiling.

- Keep application code under `src/` and custom scripts under `scripts/`, invoked through `package.json` tasks. The stack is TanStack Start/Router, React, Tailwind, shadcn/ui, Better Auth, Drizzle, and React Email.
- Run Oxlint only through Deno tasks. Do not install or invoke Node, npm, or npx, or directly declare, configure, or invoke ESLint. Transitive ESLint peer lock entries are acceptable.
- Preserve imported lint preset rules, options, and severities with one owner for overlaps. Keep legacy findings in file-scoped TODOs with diagnostic and distinct-file counts.
- When updating Oxlint or plugin lock entries, re-audit imported presets, recheck every linked compatibility issue, and smoke-test all plugin loaders.

- `src/components/ui` contains registry-generated shadcn UI components. Keep it excluded from Oxlint, Deno lint, formatting, and automatic fixes. Make only intentional integration edits and record every divergence in the file's provenance header.
  - Better Auth UI output under `src/components/auth` and `src/lib/auth`, and Emailcn output under `src/emails`, follow the same provenance rule: retain the registry command, source, and local changes. Preserve earlier provenance when replacing a source and centralize shared email changes outside imported templates.
- Build shared components under `src/components` with shadcn/ui primitives.
- Give icon-only controls an accessible name and hover explanation, usually `aria-label` and `title`. Use a Tooltip when richer content is needed.
- Keep single-use private states, skeletons, and rows in their consumer unless reuse or substantial complexity warrants extraction.

## Routes

- Prefer folder-based `src/routes/my/path/index.tsx` routes. Use flat files or route groups when they avoid excessive nesting or clarify related routes.
- Page files export `Route` with `createFileRoute`, then define the page and matching skeleton components. Load data through server functions and use `loader`, `pendingComponent`, and `beforeLoad` where needed.
- Colocate route-only components in `-components`, one named export per file, such as `my-component.tsx` for `MyComponent`.
- Colocate server functions in `-functions`, one named export per file, with the appropriate HTTP method and authorization middleware. Name `update-xyz-data.ts` for `updateXYZData` and validate through `.validator` and `Schema.toStandardSchemaV1`, without Zod.
- Keep route helpers in `-lib/utils.ts` or `utils.server.ts`. Extract cohesive groups beyond roughly 100 lines to responsibility-named files. Use `constants.ts`/`constants.server.ts` for constants and `types.ts` for local types. Database helpers should wrap one query or transaction.
- Lift shared components, functions, and types to the closest common ancestor, unless a route should retain ownership. Avoid unnecessary layout nesting and use `route.tsx` for layouts where appropriate.
- Key the organization layout outlet by the active organization ID, resetting scoped UI only after a successful switch.
- Put HTTP server routes under `src/routes/api` unless another location has a specific purpose.
- Keep `/dev` utilities synthetic and development-only, returning `404` in production.
- Keep prerendered docs generic. Fetch user-specific tokens and snippets client-side through authenticated `private, no-store` responses, never generated HTML.
- A `draft` docs section or page is hidden from navigation, routing, and the prerender crawl, and its Markdown still ships in the repository and in a fetchable chunk. Treat `draft` as unpublished, never as confidential.

## Database

- Import both database services through the server-only `src/db/index.ts` entrypoint (`@/db`). Use only `pg`, with separate Promise/Better Auth and Effect pools created by `createDatabasePool`. Effect cancellation can destroy a client and previously broke session lookups on a shared pool.
- Keep one `ManagedRuntime` bridge and use `PgClient.fromPool`. `PgClient.make`/`layer` performs a build-time probe whose failure can remain cached. Retain pool `error` listeners to prevent process termination. Do not add `allowExitOnIdle`, extra pools, global type parsers, `postgres`/postgres-js, or Nitro/signal lifecycle plumbing. The migration runner uses separate Promise-pool clients for its advisory lock and migration transactions.
- Keep generally reusable database primitives in `src/db/lib`. Keep table-specific domain interfaces and the migration runner directly under `src/db`.
- Define shared PostgreSQL columns with `caseInsensitiveText()`, `encryptedJson()`, `timestampWithTimeZone()`, `timestamps()`, `lockVersion()`, `uuidV7()`, and `uuidV7PrimaryKey()` from `src/db/lib/columns.server.ts`. Do not inline equivalent Drizzle builders.
- Drizzle Effect query failures store the Effect SQL error inside an `EffectDrizzleQueryError` Cause. Inspect it with Effect's `Cause` utilities and then standard JavaScript `cause` links instead of traversing arbitrary fields or parsing error messages.
- Keep organization-owned tables in `src/db/schema/organizations.server.ts` with centralized relations. Use `uuidV7()` inside first-party composite keys and retain Better Auth's adapter-compatible UUIDv7 keys.
- Every organization-owned table must have a non-null `organizationId`. Use `(organizationId, id)` as the primary key for first-party tables, enforce one-to-one ownership with a unique foreign key, and propagate organization-scoped alternate keys, foreign keys, and unique constraints.
- Tenant-owned tables must retain their own UUIDv7 ID, carry `organizationId` and `tenantId`, use all three columns as the primary key, and propagate composite organization/tenant foreign keys and unique constraints.
- Better Auth's `member` and `invitation` tables are exceptions only to composite organization-scoped foreign keys. They still require UUIDv7 IDs and `organizationId` foreign keys. Obtain architectural approval for other exceptions.
- Both audit columns use `DEFAULT now()`. Drizzle's `updatedAt` `$onUpdateFn` hook returns PostgreSQL `now()` but does not create a database trigger, so non-Drizzle updates must set `updated_at` explicitly.
- Define optimistic locks with `lockVersion()`, use `updateWithOptimisticLock` or `deleteWithOptimisticLock`, and map expected conflicts with `catchOptimisticLockConflict` instead of branching on error reasons at each caller. Do not add `$onUpdateFn` or a redundant check constraint. Tenant and TenantUser management APIs intentionally use last-write-wins without optimistic locks.
- Store encrypted values only through the strict Compact JWE helpers in `src/db/lib`. Never accept unreadable JWE as plaintext, write during reads, log stored values, or expose them outside an authorized no-store configuration flow. Embed dynamic row identity and compare it with sibling columns after decoding. Keep scoped access behind table-specific functions.
- Use `src/db/config.server.ts` for validated config reads/writes and `getGlobalConfig` for environment precedence and caching. Keep deployment settings global and organization settings scoped. Use migrations instead of speculative settings-version columns.
- Surface sandbox provider configuration through the owner-and-developer `/:organizationSlug/sandboxes` sidebar entry and gate it by its exact Better Auth permission. Keep every read and mutation protected independently at the server boundary because sidebar visibility is not authorization, mark authenticated configuration responses `Cache-Control: no-store`, and disable route preloading, cached loader retention, and stale rendering before returning decrypted credentials for masked editing.
- Creating an organization also creates its starter agent (named after the organization) and the `organization_configuration` row whose `default_agent_id` points at it, so `/api/v1/chat` can resolve an agent for a host that sends no `agentId`. Keep an agent's sandbox provider optional, because a provider cannot be saved before its connection test passes, and keep `default_agent_id` behind the composite organization-scoped reference, releasing it in the same transaction that deletes the agent it points at.
- Model independently usable organization integration instances as separate named rows, using `citext` when names must be case-insensitively unique. Keep provider IDs in a closed registry with shared Effect schemas and reject unknown or provider-mismatched fields before storage or return.
- Public identifier formats carry no backward compatibility before launch: change them outright and migrate the stored rows, without alias columns, deprecation windows, or backfills for data no database holds. Keep the failure loud and inside the migration's transaction instead.

Follow the [relation composition guide](src/db/README.md#relations-v2-composition) when adding schema domains.

## Shared code

- Apply global framing restrictions without embedded API path exemptions. Cross-origin fetch uses CORS, not framing permissions. Append the framing CSP as an additional policy so route-provided restrictions remain enforced.
- `schemas.ts`: reusable domain-neutral Effect schemas. Reuse its UUIDv7 and lock-version schemas instead of duplicating their predicates.
- `src/lib/slug.ts` owns organization URL slug validation and suggestions. Keep UUID-based public identifiers and database operations at their resource boundaries.
- Keep general helpers in `src/lib/utils.ts` or `utils.server.ts`.
- `src/lib/config/index.ts` is guarded as server-only and exports `getGlobalConfig(key)` with environment precedence and process-local caching. Keep definitions and validation in `src/lib/config`, while the Drizzle `config.value` codec owns JWE encryption and `src/db/config.server.ts` owns validation and unreadable-row recovery. `DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are required. Uppercase registry environment overrides take precedence and stay out of database reads and `/configure`, same-process writes invalidate the cache, and errors never include configuration values.
- Keep shared constants in `src/lib/constants.ts` and shared types in `src/lib/types.ts`, including registry types and the secret-free `PublicConfig`. Better Auth setup lives in `src/lib/auth.server.ts`.
- Avoid creating unrelated files in `src/lib`. `src/lib/chat` owns reusable chat execution, identity, attachments, and sandbox orchestration, with no imports from routes. HTTP parsing, SSE responses, headers, and error status mapping stay in the API routes. `src/lib/sandbox` owns provider implementations intended for later extraction, and its package-facing modules must not import webapp configuration, authentication, database, route, or UI modules.
- Before writing or extending a sandbox provider adapter, check current TanStack AI provider packages, open pull requests and issues, npm, and the vendor SDK. Prefer a maintained TanStack adapter, use the official vendor SDK directly when none exists, and link the exact upstream source or missing behavior beside unavoidable custom lifecycle code. Do not insert a second generic sandbox abstraction unless it conforms to the TanStack contract.

## Email

- `index.ts` exports `sendEmail` plus one `send<Template>Email` wrapper per template, each owning its own subject and props.
- Preserve imported templates' native prop contracts where practical. Map Better Auth data in `index.ts`, co-locate each typed preview-props factory at the bottom of its template, and preview with synthetic props at `/dev/emails`.
- `sendEmail` loads only the selected `providers/*.ts` module, through a static map of dynamic imports.
- `provider`, `from`, and `replyTo` default to the `email_provider` and `email_from_address` config values and the resolved `from`.
- `email_from_address` is validated for shape in the config registry, because Resend and SES accept only `email@example.com` or `Name <email@example.com>` and a typo would otherwise fail at send time.
- Keep one SMTP provider and one Nodemailer transport for local, self-hosted, and hosted servers: host, port, and security default to `127.0.0.1`, `1025`, and `none`. `none` disables TLS, `auto` uses STARTTLS when advertised, `starttls` requires STARTTLS, `tls` starts with TLS, and username/password must be supplied together or both omitted. Do not add product-specific SMTP providers, queues, retries, DKIM, OAuth, pooling, bounce handling, certificate controls, cipher controls, or TLS-version controls without explicit product scope.
- Templates cannot resolve relative paths, so build absolute URLs from the configured `app_base_url`. Attachment `path` is a URL, a `data:` URI, or bare base64.

## Configuration and authentication

- `/configure` (`src/routes/configure`) is the operator surface for database-backed config. If the login limiter table is missing, render sign-in without throttling. Authenticate short, stateless sessions only with the first active `DATABASE_ENCRYPTION_KEY` value. Never use database credentials. Require production HTTPS and same-origin mutations, and trust forwarded host/protocol only when the request's own peer is the loopback reverse proxy. Send secret-kind values to the browser only through `revealConfigValue`, one key at a time, so a page load never carries them. Mask values until explicitly revealed, approve migrations by exact name and digest, and derive the app gate from process-cached configuration validity and migration state rather than a persisted completion marker.

- Authentication uses Better Auth with verified email/password, Google, GitHub, and Organizations. Keep username, passwordless, OTP, magic-link, change-email, account deletion, organization deletion, teams, and dynamic roles disabled unless product scope changes. The Better Auth instance is built per config snapshot through `getAuth()`. Google and GitHub are enabled only when both of a provider's config credentials are set.
  - Require both Turnstile keys before setup can complete and integrate through Better Auth's server plugin and Better Auth UI's CAPTCHA contribution so the UI library owns token headers and single-use resets. Application forms may read `x-captcha-response` only to disable submission until an active CAPTCHA is ready.
  - Use `user` only for the global authenticated identity, `account` for a credential or OAuth connection, `organization` for the SaaS boundary, and `member` for a user's relationship to an organization. Name organization-management routes, files, navigation, and visible copy “Members”. Do not use “People” or “Workspace” as synonyms.
  - Keep `termsAcceptedAt` server-owned. When any legal policy URL is configured, require explicit legal acceptance for credential and OAuth signup. When none is configured, do not display or record acceptance. Disable implicit OAuth signup, and accept provider identities or invitations only after verified-email checks.
  - Keep OAuth tokens encrypted, account linking restricted to matching verified emails, unlinking the final sign-in method disabled, session cookie caching disabled, and rate limits in the database.
  - Read `src/lib/auth/AGENTS.md` before changing authentication email delivery. It owns blocking sends, safe logging, rate limits, recovery, and accepted enumeration tradeoffs.
  - Keep `tanstackStartCookies()` last in the server plugin list and enforce fresh-session requirements at each sensitive operation.
  - Configure organization roles through Better Auth's static server/client role maps and hooks: creators are owners, invitations initially select viewer, owner/developer/viewer roles are composable, viewer and developer share the Better Auth member access statement, and roles outside the configured map are rejected. Keep dynamic roles disabled.
  - Put organization API keys at the dedicated `/:organizationSlug/api-keys` sidebar destination and gate it by its exact Better Auth permission. Page and sidebar visibility are navigation UX, not authorization. Keep organization API key names required and server-trimmed, force the `abo_` secret prefix, assemble the one-time credential as `key_<organizationId>_<id>_<abo-prefixed-secret>` from database UUIDv7 IDs without a stored API-key slug, default expiration to Never, use a limit of 100 requests per 5 minutes, grant API-key actions only to owners and developers, and neither render nor fetch or list keys for viewers. Map the plugin model to `api_key` and its generic `referenceId` field to `organizationId` so the organization relationship remains explicit in application schema. Follow `src/lib/chat/AGENTS.md` for offline JWT verification and its signing-key boundary. Never expose the bearer secret to browser code or enable [`enableSessionForAPIKeys`](https://better-auth.com/docs/plugins/api-key/advanced#sessions-from-api-keys), which only supports user-owned keys and is not recommended for this organization-owned credential.
  - Validate organization-issued SDK tokens against the platform `astralbeam` audience without feature scopes. Read tenant identity from separate `user` and `tenant` claims, keep SDK-facing fields camelCase and JWT wire claims snake_case, and preserve caller-owned metadata keys verbatim. Treat `kid` as a lookup hint until the organization-owned key, signature, lifecycle, issuer, and audience are verified, and do not require the optional JWT subject.
  - The `$orgSlug` URL segment is the organization a page shows. Resolve it to the organization, membership, role, and permissions on the server, carry that through route context and each page loader's `{ data, permissions }`, and require the slug on components that build dashboard routes. API-key components use `organizationId` for ownership and database IDs for credential rendering. Do not refetch the active organization in a component or make ID-based credential rendering conditional on a slug.
  - Configure authentication plugins only with product-specific overrides. Rely on Better Auth defaults and TanStack response headers when they already satisfy the requirement.

## Server boundaries

- Use parameterized TanStack function middleware to share repeated authorization and trusted context. Keep resource server functions explicit when their validators, permissions, errors, or result contracts differ. Do not add a parallel Effect HTTP/RPC transport merely to hide small wrappers.
- Public resource and chat APIs share the executable Effect HttpApi boundary. Read `src/routes/api/v1/AGENTS.md` before changing those APIs, their repositories, OpenAPI export, or adding a subsequent API version. Dashboard server functions remain separate, and chat preserves its AG-UI protocol within the shared transport.
- Write new server-side application logic as Effect programs with typed failures. Yield native Effect integrations directly, lift unavoidable Promise APIs with `Effect.tryPromise`, and run Effects only at framework boundaries.
- Generate Effect validation schemas from Drizzle tables with the built-in [`drizzle-orm/effect-schema`](https://orm.drizzle.team/docs/effect-schema) helpers at database and API boundaries instead of duplicating table shapes by hand. The versioned public REST API is an exception: keep its schemas independent of Drizzle so database changes cannot silently change its contract.

- Keep new functions at cyclomatic complexity 20 or lower and do not increase higher legacy functions. Extract focused helpers instead of suppressing the complexity finding.
- Keep the root `ThemeProvider` around the document content so its SSR startup script applies the persisted or system theme before first paint. Do not defer initial theme application to a post-hydration effect.
- `deno task e2e` runs the Playwright browser suite in `e2e/`, which starts its own webapp, SMTP sink, and `_e2e` database and drives `/configure`, signup, and every organization page. Read `e2e/README.md` before changing it, put focused specs in `specs/features` where the journey's recorded baseline makes them runnable on their own, compose them from `e2e/pages`, keep anything that starts a container in the opt-in `specs/sandbox`, and keep the suite out of `check`, `test`, `ready`, and CI so it stays an on-demand verification tool.

- Never hardcode the word "AstralBeam" or any AstralBeam-specific description or nomenclature anywhere in the app. Assume it may be white-labeled.
  - Put labels and constants in `src/lib/constants.ts` and import them elsewhere so changes stay centralized.
  - Use `APP_NAME` for display text and `APP_HANDLE` for brand-derived domains, protocol identifiers, asset paths, and test fixtures.

- Recheck session, organization, role, and data scope at every server function and query. Route guards provide navigation protection only. Return safe errors and keep sensitive diagnostics server-side.
- Use `*.server.ts` for server-only code. Add `import "@tanstack/react-start/server-only"` only to unsuffixed server entrypoints such as `index.ts`. Never expose server environment variables to clients.

## Seed data

- Keep `db-seed` rerunnable, transactional, loopback-only, and separate from reset/migration commands. It prepares local verification and writes `examples/todos/.env` only when absent. See the [seed runbook](src/db/README.md#seed-sample-data) for its inventory and commands.
  - `scripts/seed/fixtures.ts` is the only source of seeded identities and is imported by `examples/todos/e2e` across the project boundary, so keep it free of imports and runtime dependencies.
  - Seed modules run under a plain `deno run`, which cannot resolve the `@/` alias. Import tables through the relative `src/db/schema.server.ts` path and never from `src/db/index.ts`, `agent.server.ts`, or `config.server.ts`.
  - The seed never writes `openai_api_key`, and skips any config key whose uppercase environment variable is set, because the environment takes precedence and `/configure` renders those fields read-only. Put the OpenAI key in `webapp/.env.local`.
