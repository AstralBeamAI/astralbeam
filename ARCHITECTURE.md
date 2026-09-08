# Architecture

How AstralBeam is put together, for someone about to change it. Rules and conventions live in the `AGENTS.md` files; this document is the theory of the system.

## What AstralBeam is

AstralBeam lets an Organization — an AstralBeam customer, typically a SaaS app — add a production-ready agent to its own product. The Organization's employees are organization users, who sign in to the AstralBeam dashboard to configure agents, API keys, sandbox providers, and members. The Organization's own customers are Tenants, and the people inside a Tenant who type into the embedded chat sidebar are tenant users (`TenantUser`). The Organization's server mints a short-lived token for each of its tenant users; the SDK widget in that user's browser presents it to the chat endpoint, which runs the agent the Organization configured. No AstralBeam account is ever created for a tenant user.

## The four projects

- `webapp` — the TanStack Start React application. It is the dashboard organization users sign in to, the `/api/v1/chat` agent endpoint tenant users' browsers stream from, the `/configure` operator surface, and the `/docs` SDK guides. It owns the database, the theme, and all server logic.
- `sdk` — the npm package `@astralbeam/sdk`, with four public entry points. `client` is a small vanilla loader that attaches a shadow root and lazily imports the widget chunk (which carries its own bundled React, so a host page need not have React at all); `core` is the framework-free headless session — authentication, transport, tool protocol, transcript state; `react` is a thin wrapper that binds to the host's React; `server` mints chat auth tokens and imports no framework.
- `www` — the Astro marketing site, built fully static and deployed to Cloudflare as assets only.
- `examples/todos` — a standalone TanStack Start app that consumes the SDK's built `dist` through a `file:` dependency, mints demo tokens on its own server, and points the widget at the webapp's `/api`. It also hosts the Playwright end-to-end suite today, in `examples/todos/e2e`, which imports the webapp's seed fixtures across the project boundary.

The four are independent Deno projects, each with its own `deno.jsonc`, `package.json` scripts, and `deno.lock`; there is deliberately no `workspace` field anywhere and no root lockfile. They ship on different schedules to different places — a compiled binary, a Cloudflare Worker, an npm tarball, and nothing at all — so each keeps its own toolchain, its own frozen dependency set, and its own `check`, `test`, and `ready` tasks — with those task names meaning the same thing everywhere, and `ready` meaning `check`, `test`, and `build`. The one thing they share is the root `tsconfig.base.json`, which holds the compiler options all four already agreed on and nothing else. The root `deno.jsonc` is a launcher that forwards only `install`, `dev`, and `build`.

```text
Host app page (the Organization's SaaS, in a tenant user's browser)
│
├─ @astralbeam/sdk client loader ──► shadow root ──► widget chunk (own React)
│      │
│      │ 1. fetch the host's own token endpoint
│      ▼
│    Host app server
│      createChatAuthToken({ apiKey, user, tenant })
│      apiKey = key_<orgSlug>_<keySlug>_abo_<secret>, never leaves the server
│      ──► HS256 JWT signed with the key's SHA-256 digest, 60–600 s
│
└─ 2. POST /api/v1/chat, Authorization: Bearer <jwt>
        │
        ▼
     webapp
      ├─ verify the JWT against the stored api_key digest ──► ChatPrincipal
      ├─ resolve the agent (agentId, else the organization's default)
      ├─ normalize attachments ──► provider parts + in-memory decoded files
      └─ chat() ──► model
           ├─ host tools + widgets ──► executed back in the host page
           ├─ read_attachment      ──► executed here, over the run's bytes
           └─ sandbox_* tools      ──► executed in the agent's sandbox provider
                └─ sandbox_publish_artifact ──► ticket ──► /api/v1/chat/files?ticket=
      ◄── Server-Sent Events (AG-UI events) stream back to the widget
```

## Identity and tenancy

- Two identity systems meet here and never mix. Better Auth owns the platform side: a `user` is a person with an AstralBeam login, a `member` row binds that user to an `organization` with a role of owner, developer, or viewer, and an `invitation` is a pending membership. This is the only identity that can sign in to the dashboard.
- Tenant identity is asserted, not stored. An Organization creates an organization API key at `/:organizationSlug/api-keys`; the copied credential is `key_<organizationSlug>_<keySlug>_abo_<secret>`, where the `abo_`-prefixed tail is Better Auth's raw api-key value and the head is a public id the Organization can safely log. The database stores only a SHA-256 digest, in `api_key.key`. The api-key plugin's generic `referenceId` field is mapped to a real `organizationId` column so the ownership is explicit in the schema rather than implied by a convention.
- The Organization's server calls `createChatAuthToken` from `@astralbeam/sdk/server`, which signs an HS256 JWT: `kid` is the key's public id, `iss` is the organization slug, `aud` is `astralbeam`, `ver` pins the claim shape, `exp` is 60–600 seconds out, and identity travels as two separate claims — `user` (the TenantUser: id, optional name, `admin`, `metadata`) and `tenant` (id, optional name, `metadata`). The signing key is the SHA-256 digest of the raw API key, which is exactly what the database holds, so the host signs offline and the endpoint verifies without either side transmitting the secret.
- `/api/v1/chat` verifies in a fixed order, and the order is the security property: parse `kid` as a lookup hint only, load the key row by organization slug plus key slug, verify the HS256 signature and `typ`/`iss`/`aud`/`iat`/`exp`, re-compare `kid` against the now-verified header, size-cap the identity claims, decode the payload with excess properties rejected, and only then re-read the key's `enabled` and `expires_at`. The trusted context is the organization id from the loaded row plus the token's two identity claims; nothing organization-scoped ever comes from the request body.
- The consequence, recorded in `webapp/src/lib/chat/auth.server.ts`, is that read access to `api_key.key` is sufficient to forge a chat token. That column is a signing-key boundary, not merely a password hash.
- The `tenant` and `tenant_user` tables exist and carry the composite keys tenancy needs, but nothing on the request path reads or writes them: the only writer today is `webapp/scripts/seed/tenants.ts`, and the seed's `acme` tenant deliberately matches the identity `examples/todos` mints so the two views will line up later. Persisting a tenant from a verified token is future work; until then a Tenant's identity lives only in the tokens its Organization signs.
- Organization-owned first-party tables use `(organization_id, id)` as the primary key rather than `id` alone, and tenant-owned tables use `(organization_id, tenant_id, id)`. The point is not lookup speed: it is that every child reference becomes a composite foreign key, so `agent.sandbox_provider_id` points at `(sandbox_provider.organization_id, sandbox_provider.id)` and a row physically cannot reference another organization's row. With single-column keys, a cross-organization reference is one forgotten `where` clause away. Better Auth's own tables keep their upstream single-`id` shape with a plain `organization_id` column, so their tenancy is enforced by application queries instead — including `member`, which has no database uniqueness on `(organization_id, user_id)` at all.

## Where state lives

Better Auth-owned:

| Table          | Purpose                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `user`         | A person with an AstralBeam login: email, verification state, `terms_accepted_at`.                          |
| `account`      | One credential or OAuth connection belonging to a `user`; OAuth tokens live here, encrypted by Better Auth. |
| `session`      | An active dashboard session, including the selected `active_organization_id`.                               |
| `verification` | Short-lived tokens for email verification and password reset.                                               |
| `organization` | The AstralBeam customer, addressed publicly by a unique `slug`.                                             |
| `member`       | A `user`'s role in an `organization`: owner, developer, or viewer.                                          |
| `invitation`   | A pending membership addressed to an email, with its role and expiry.                                       |
| `api_key`      | An organization API key: SHA-256 digest, `slug`, `enabled`, `expires_at`, and the plugin's quota columns.   |

Organization-owned first-party — `(organization_id, id)` primary keys, `lock_version` optimistic locks on all three:

| Table                        | Purpose                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `agent`                      | One configured agent: `slug`, `name`, `system_prompt`, `attachments_enabled`, optional `sandbox_provider_id`. |
| `sandbox_provider`           | One named sandbox backend: provider type, public initializer options, and encrypted credentials.              |
| `organization_configuration` | One row per organization, holding the `default_agent_id` a host that sends no `agentId` resolves to.          |

Tenant-owned — `(organization_id, tenant_id, id)` for `tenant_user`, and a composite foreign key back to `tenant`:

| Table         | Purpose                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `tenant`      | An Organization's own customer, keyed by the `external_id` the Organization chooses.   |
| `tenant_user` | A person inside a Tenant, keyed by a tenant-local `external_id`, plus an `admin` flag. |

Platform:

| Table        | Purpose                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `config`     | Global runtime settings, one row per registry key, with an encrypted `value`.                    |
| `rate_limit` | Counter storage shared by Better Auth's limits, the `/configure` login limiter, and `/api/v1/chat`. |

- Exactly two columns are encrypted, both through the `encryptedJson()` Drizzle column type: `config.value` and `sandbox_provider.credentials`. The column type owns compact JWE — `dir` plus `A256GCM`, `kid` in the protected header, content key HKDF-derived from the active `DATABASE_ENCRYPTION_KEY` root — so a caller cannot accidentally store plaintext. Each payload embeds its own row identity (`config` embeds its `key`; `sandbox_provider` embeds both ids and its provider type) and that identity is compared with the sibling columns after decoding, so a ciphertext cannot be transplanted between rows.
- Three in-process caches matter. The configuration snapshot is one whole-state object per process, guarded by a generation counter so a refresh that races an invalidation is discarded. The migration state is a memoized promise. The sandbox lease table is a plain `Map` in `webapp/src/lib/chat/sandbox.server.ts`. All three are process-local by design: another replica picks up configuration on restart, and a conversation that lands on another replica starts a fresh sandbox rather than resuming one.

## The configuration model

Only two settings are environment variables. Everything else is a row in `config`.

```text
DATABASE_URL ─────────────┐
DATABASE_ENCRYPTION_KEY ──┤ comma-separated; the first entry encrypts, the rest decrypt
                          ▼
        ┌── /configure ──────────────────────────────────────┐
        │  the operator signs in with the FIRST key itself   │
        │  approves pending migrations by exact name + digest │
        └───────────────┬────────────────────────────────────┘
                        ▼
                  config table — JWE-encrypted `value`, one row per registry key
                        │
   UPPERCASE env var ───┤ overrides a key, excludes it from the DB read entirely,
   (APP_BASE_URL, …)    │ and renders that field read-only in /configure
                        ▼
              process-cached snapshot, read through getGlobalConfig
                        │
                        ▼
        app gate: zero config issues AND zero pending migrations,
        else page routes redirect to /configure and API routes answer 503
```

- Settings live in the database because a self-hosted deployment is one binary and one PostgreSQL database. An operator who can reach `/configure` can finish setup, add an OpenAI key, or fix an SMTP host without a redeploy, a config file, or shell access to the process — and the same surface is what makes first boot possible at all, since the app gate is derived from configuration validity and migration state rather than from a persisted "installed" flag.
- The key _list_ is what makes rotation possible: the first entry encrypts every write and the rest still decrypt, so `new,old` plus a re-save per value moves a deployment forward with no downtime and no plaintext window. A row encrypted under a fallback key is flagged and re-encrypted on its next save; a row that cannot be read at all can be replaced blind, without revealing what it held.
- That same key is the operator credential — `/configure` compares its SHA-256 against the derived root and issues a 15-minute stateless session. Database credentials are deliberately not accepted. Because the key grants access to every encrypted value in the database, `/configure` needs an ingress allowlist, VPN, or identity-aware proxy in front of it.
- An uppercase environment variable wins over the database for any registry key, and the overridden key is dropped from the database read rather than read and shadowed. That keeps the settings a hosting platform injects out of the surface an operator can edit, and out of the rows an operator's save could overwrite.

## The server programming model

- TanStack Start server functions and server route handlers are the only framework boundary. Route guards (`beforeLoad`) are navigation UX; every server function re-checks session, organization, and role independently, because a guard also runs in the browser.
- Server logic below that boundary is written as Effect programs with typed failures (`Data.TaggedError`), so a failure a caller must handle appears in the type instead of as a thrown value. Effects run only at the boundary, through the single `ManagedRuntime` bridge exported from `webapp/src/db/index.ts` as `runDatabaseEffect`.
- That module holds two `pg` pools, and the reason is a bug rather than symmetry. The Effect SQL client cancels the running query and releases or destroys its client whenever a fiber is interrupted; on a pool shared with Better Auth, an aborted request left behind a connection that later failed a session lookup with "Client was closed and is not queryable". Better Auth keeps the Promise-shaped Drizzle handle, Effect programs get their own pool, and neither driver's client lifecycle reaches the other's queries.
- Not all server code is Effect yet, and that is honest rather than aspirational. Better Auth is Promise-shaped and stays that way. The sandbox lifecycle is Promise-shaped because TanStack's `SandboxHandle`, sandbox `ensure`, and tool `execute` contracts are, so that module is deliberately the async/await boundary itself. New server logic is written as Effect, and the direction is all-in.

## Build, run, deploy

- `deno task dev` from the root runs the webapp on 4500, `www` on 4600, and the todos example on 4700, all with `strictPort` so a busy port is an error rather than a silent move to another one — a moved port would leave `APP_BASE_URL`, auth cookies, and email links pointing at the wrong server. The SDK has no dev server, so `dev` also starts its `tsdown --watch` build: an SDK source change rewrites `sdk/dist`, which the example resolves through its `file:` dependency, and a page reload picks it up. `./scripts/setup.sh` is the one-time step before that: it installs, migrates, seeds, and builds the SDK.
- The webapp builds in two stages. Vite plus Nitro emit `.output/server/index.mjs` and `.output/public`, then `deno compile` produces a single `.output/astralbeam` binary. `deno task binary:check` enforces a 200 MiB ceiling and then smoke-tests the binary end to end — boots it in a temporary directory, polls `/api/status`, fetches a hashed asset, and requires a clean SIGTERM exit. CI runs the same check.
- The server runs under the named `runtime` permission set: `env`, `net`, `read`, and five `sys` entries, with no `write`, `run`, or `ffi`. Scripts that need more use the separate `tooling` set.
- `sdk` builds with tsdown in two passes that treat React oppositely. The client entry bundles React into its lazy widget chunk, so a host page needs none of its own; the `core`, `react`, and `server` entries never bundle it, so the React wrapper binds to the host's copy. Publishing is `deno task build` then `npm publish`, and only `dist`, `README.md`, `LICENSE`, and `package.json` ship.
- `www` is a static Astro build deployed with wrangler as assets only; its `wrangler.json` has no `main`, so there is no server script to run.
- CI is one workflow, on pull requests and pushes to `main`, with no write token and no auto-fixing. A `check` job runs `deno install --frozen` and `deno task ready` per project as a four-way matrix, so each reports its own result; the webapp leg also runs `binary:check`, and the todos leg builds the SDK first because it consumes `sdk/dist`. A separate `e2e` job starts Compose, migrates and seeds the database, builds the SDK, and runs the deterministic Playwright project — the one that never calls a model. There is no deploy or publish workflow — the `www` deploy and the npm publish are manual.

## Glossary

- **Organization** — an AstralBeam customer, typically a SaaS app. The membership and data boundary.
- **organization user** — an employee of an Organization who signs in to the AstralBeam dashboard: a Better Auth `user` with a `member` row.
- **Tenant** — one of an Organization's own customers, identified by an `external_id` the Organization chooses.
- **TenantUser** — a person inside a Tenant who types into the embedded chat. Has no AstralBeam login; identified by a tenant-local `external_id`.
- **agent** — a configured assistant: a name, a system prompt, an attachment policy, and optionally a sandbox provider. Resolved per chat request.
- **organization API key** — a long-lived credential an Organization keeps on its own server, formatted `key_<organizationSlug>_<keySlug>_abo_<secret>`. Only its SHA-256 digest is stored.
- **chat auth token** — the short-lived (60–600 s) HS256 JWT an Organization's server mints per tenant user, sent as a bearer header. Never a cookie, so there is no CSRF surface.
- **sandbox provider** — a stored, named configuration for a vendor sandbox (Daytona, Docker, Sprites, Vercel). Selecting one on an agent is what gives that agent sandbox tools.
- **artifact** — a file the agent published out of its sandbox for the user, downloaded through a signed ticket bound to a digest of the exact published bytes.
- **attachment** — a file a tenant user attached to a message, delivered either as a provider modality (image, PDF) or as a named file the agent reads with `read_attachment`. Never stored in the database.
- **host tool / widget** — a function or component the host page declares to the agent and executes in its own page, with agent-chosen input.
- **`/configure`** — the operator surface for database-backed settings and migration approval, authenticated by the active `DATABASE_ENCRYPTION_KEY` value.
- **config registry** — the closed list of settings keys with their group, kind, validation, and defaults, in `webapp/src/lib/config/registry.server.ts`.
- **public id / slug** — the URL-safe identifier a resource is addressed by across a boundary (`agent_<uuidv7>`, `key_<org>_<key>`), as opposed to its internal UUIDv7. An agent's public id is its stored UUIDv7 behind an `agent_` prefix, applied by `webapp/src/db/agent.server.ts`, so it is opaque and carries no organization name.
- **optimistic lock version** — the `lock_version` integer on a first-party mutable row; a conflicting concurrent write fails rather than silently winning.
- **setup complete** — the derived state (zero config issues, zero pending migrations) that opens the app gate. Not a persisted flag.
