# Architecture

AstralBeam lets an Organization embed an agent in its product. Organization employees configure it in the dashboard. The Organization's server authenticates its Tenants and tenant users, then issues short-lived tokens for the embedded SDK.

Implementation rules live in [AGENTS.md](AGENTS.md) and its project-specific counterparts. See [Setup](SETUP.md) for deployment and local development.

## The four projects

| Project | Responsibility | Output |
| --- | --- | --- |
| `webapp` | Dashboard, `/configure`, `/docs`, management APIs, and chat execution | Deno binary |
| `sdk` | Widget, headless session, React bindings, and token minting | `@astralbeam/sdk` npm package |
| `www` | Static Astro website | Cloudflare assets |
| `examples/todos` | Standalone SDK consumer and browser tests | Demo application |

Each project owns its dependencies, lockfile, and tooling because they ship independently. The root shares compiler defaults in `tsconfig.base.json` and launches `install`, `dev`, and `build` tasks.

```text
Tenant user's browser
├─ Host application
│  └─ SDK loader → shadow root → lazy widget with bundled React
│       │
│       ├─ 1. Request token from the host's authenticated endpoint
│       │     Host server: createAstralBeamToken({ apiKey, user, tenant })
│       │     API key stays server-side
│       │
│       └─ 2. POST /api/v1/chat with Bearer JWT
│              webapp
│              ├─ Verify token → ChatPrincipal
│              ├─ Resolve agent and normalize attachments
│              └─ Run model
│                 ├─ Host tools/widgets → execute in the host page
│                 ├─ read_attachment → read request-local bytes
│                 └─ Sandbox tools → provider sandbox
│                    └─ Publish artifact → signed download ticket
└─ Receive AG-UI events over Server-Sent Events
```

## Identity and tenancy

Dashboard identity and embedded-chat identity are separate. Better Auth owns dashboard users, accounts, sessions, memberships, invitations, and organization API keys. Tenant users have no AstralBeam login.

An organization API key is `key_<organizationId>_<id>_abo_<secret>`. Its IDs are immutable UUIDs. Only `organization` stores a slug, used for dashboard URLs. Agent public IDs are `agent_<organizationId>_<id>`.

The host signs chat JWTs using the SHA-256 digest of the complete `abo_<secret>` value. AstralBeam verifies them against the stored digest without receiving the raw key. Consequently, read access to `api_key.key` is enough to forge chat tokens. Treat it as signing-key access.

JWTs carry separate `user` and `tenant` claims, use the organization UUID as issuer and `astralbeam` as audience, and expire after 60–600 seconds. Trusted organization context comes from the verified key row. The [chat authentication instructions](webapp/src/lib/chat/AGENTS.md#authentication) define verification order and lifecycle checks.

The management API persists Tenants and TenantUsers. Chat authenticates their external identities from signed claims without reading or upserting those records. A signed `user.admin` claim grants scoped management access independently of stored TenantUser `admin` data. See [API authentication](webapp/src/routes/docs/-content/api/authentication.md).

First-party organization-owned rows use `(organization_id, id)` keys. Tenant-owned rows add `tenant_id`. Composite foreign keys prevent cross-organization or cross-Tenant references at the database boundary. Better Auth tables retain adapter-compatible keys and require application-level scoping.

## Where state lives

| Tables | State |
| --- | --- |
| `user`, `account`, `session`, `verification` | Dashboard identity and authentication |
| `organization`, `member`, `invitation` | Customer organization and employee access |
| `api_key` | Organization credential digest, lifecycle, and quotas |
| `agent` | Name, prompt, attachment policy, optional sandbox provider |
| `organization_configuration` | Organization's default agent |
| `sandbox_provider` | Named provider options and encrypted credentials |
| `tenant`, `tenant_user` | Customer-owned external identities and metadata |
| `config` | Encrypted deployment settings |
| `rate_limit` | Shared authentication, setup, and API counters |

The application encrypts `config.value` and `sandbox_provider.credentials` through the Drizzle column codec. Compact JWE uses keys derived from `DATABASE_ENCRYPTION_KEY`. Payloads include row identity, checked after decoding to prevent ciphertext transplantation. Better Auth separately encrypts retained OAuth tokens.

Configuration snapshots, migration state, and sandbox leases are process-local. Restart other replicas after configuration changes. A conversation routed to another replica may receive a fresh sandbox.

## Configuration

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are the required bootstrap variables. Other settings normally live in `config`, with uppercase environment overrides taking precedence and making corresponding `/configure` fields read-only.

The first encryption-key entry encrypts writes and authenticates the operator. Older entries decrypt existing values during rotation. Unreadable values can be replaced without revealing their contents. See [key rotation and operator access](SETUP.md#configure-the-environment).

`/configure` approves migrations by exact name and digest. The application opens only when configuration is valid and no migrations are pending. There is no persisted setup-complete flag. This lets an operator complete first boot or repair settings through the same interface.

## Server execution

TanStack Start server functions and routes form the framework boundary. Public management and chat APIs share an Effect HttpApi contract. Chat retains AG-UI input and streaming, while management resources use their own schemas and authorization.

New application logic uses Effect with typed failures, executed through the `ManagedRuntime` bridge. Better Auth and TanStack sandbox lifecycle contracts remain Promise-based.

The database module owns separate `pg` pools for Promise and Effect clients. Effect cancellation may release or destroy a client, so sharing that pool previously broke unrelated Better Auth session queries. See [database instructions](webapp/AGENTS.md#database) for the required pool lifecycle.

## SDK boundary

The vanilla entry lazily loads a widget with its own React and styles. The React entry uses the host's React. Both build on the framework-free headless core, which owns authentication, transport, tool execution, and transcript state.

Host tools and widgets execute in the host page with agent-chosen input. Attachments stay at user/tool authority, never in system prompts. Sandbox artifacts are downloaded through short-lived tickets bound to the published bytes. These boundaries are detailed in [SDK security](webapp/src/routes/docs/-content/sdk/security.md).

## Build and deployment

The webapp compiles to a Deno binary with an out-of-tree startup, asset, shutdown, and size check. The SDK publishes independently, and `www` deploys as static assets. CI validates each project and runs deterministic browser tests. Model-driven tests require separate credentials and spend credits.

Commands and build constraints belong to each project's instructions and manifests. The [root quick start](README.md#local-development) launches local development, and the [browser-suite guide](examples/todos/e2e/README.md) explains test selection and evidence capture.

## Glossary

- **Organization**: an AstralBeam customer, usually a SaaS app.
- **Organization user**: an employee who uses the dashboard through a Better Auth membership.
- **Tenant**: one of the Organization's customers, identified by its chosen external ID.
- **TenantUser**: a Tenant's user, identified by a tenant-local external ID.
- **Chat auth token**: the short-lived JWT the host issues for a tenant user.
- **Attachment**: a user-supplied file included in a chat request.
- **Artifact**: a sandbox file published for download through a signed ticket.
