# Architecture

AstralBeam lets an Organization embed an agent in its product. Organization employees configure it in the dashboard. The Organization's server authenticates its Tenants and tenant users, then issues short-lived tokens for the embedded SDK.

Implementation rules live in [AGENTS.md](../AGENTS.md) and its project-specific counterparts. See [Setup](SETUP.md) for local development and [self-hosting](../platform/src/routes/docs/-content/self-hosting/overview.md) for deployment.

## The projects

| Project | Responsibility | Output |
| --- | --- | --- |
| `platform` | Dashboard, `/configure`, `/docs`, management APIs, and chat execution | Bun binary |
| `sdk` | Widget, headless session, React bindings, and token minting | `@astralbeam/sdk` npm package |
| `cli` | Organization admin commands over the public API, built on the SDK | `@astralbeam/cli` npm package and Bun binaries |
| `website` | Prerendered TanStack Start website | Cloudflare assets |
| `examples/todos` | Standalone SDK consumer and browser tests | Demo application |
| `examples/linearity-react` | Project-tracking playground with browser state, Astro tools, and Basic Auth | Bun server and browser assets |
| `examples/todos-rails` | Rails consumer of the SDK from jsDelivr, outside the Bun toolchain | Demo application |

Each project owns its dependencies and tooling because they ship independently. Bun installs the six projects as one workspace with a root lockfile and local SDK links. The root shares compiler defaults in `tsconfig.base.json` and launches `dev` and `build` tasks.

```text
Tenant user's browser
├─ Host application
│  └─ SDK loader → shadow root → lazy widget with bundled React
│       │
│       ├─ 1. Request token from the host's authenticated endpoint
│       │     Host server: createAstralBeamToken({ apiKey, user, tenant })
│       │     API key stays server-side
│       │
│       ├─ 2. POST /api/v1/me with Bearer JWT
│       │     Synchronize the Tenant and current TenantUser
│       │
│       └─ 3. POST /api/v1/chat with Bearer JWT
│              platform
│              ├─ Verify token → ChatPrincipal
│              ├─ Resolve agent and normalize attachments
│              └─ Run model
│                 ├─ Host tools/widgets → execute in the host page
│                 ├─ read_attachment → read request-local bytes
│                 └─ Sandbox tools → provider sandbox
│                    └─ Publish artifact → verified private file
└─ Receive AG-UI events over Server-Sent Events
```

## Identity and tenancy

Dashboard identity and embedded-chat identity are separate. Better Auth owns dashboard users, accounts, sessions, memberships, invitations, and organization API keys. Tenant users have no AstralBeam login.

An organization API key is `key_<organizationId>_<id>_abo_<secret>`. Its IDs are immutable UUIDs. Only `organization` stores a slug, used for dashboard URLs. Agent public IDs are `agent_<organizationId>_<id>`.

The host signs chat JWTs using the SHA-256 digest of the complete `abo_<secret>` value. AstralBeam verifies them against the stored digest without receiving the raw key. Consequently, read access to `api_key.key` is enough to forge chat tokens. Treat it as signing-key access.

JWTs carry separate `user` and `tenant` claims, use the organization UUID as issuer and `astralbeam` as audience, and expire after 60–600 seconds. Trusted organization context comes from the verified key row. The [chat authentication instructions](../platform/src/lib/chat/AGENTS.md#authentication) define verification order and lifecycle checks.

The management API persists Tenants and TenantUsers. Before becoming ready, SDK authentication calls JWT-only `POST /api/v1/me` to synchronize the signed Tenant and current TenantUser atomically. Organization JWTs instead return the existing member and current role. Token issuance does not write these identities. Chat resolves existing internal identities and participant grants without provisioning them. A signed `user.admin` claim grants scoped management access independently of stored TenantUser `admin` data. See [API authentication](../platform/src/routes/docs/-content/api/authentication.md).

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
| `model_provider`, `provider_model`, `agent_model` | Model connections, enabled models, and agent assignments |
| `tenant`, `tenant_user` | Customer-owned external identities and metadata |
| `chat_thread`, `chat_participant`, `chat_message`, `chat_message_part`, `chat_tool_response` | Shared history, ancestry, turn claims, structured content, and expected tool responses |
| `file_object` | Private object-storage metadata and upload/cleanup state |
| `usage_limit`, `usage_limit_counter` | Token/spend budgets and per-subject window counters |
| `config` | Encrypted deployment settings |
| `rate_limit` | Shared authentication, setup, and API counters |
| `cache_entry` | Namespaced shared cache with expiry, including encrypted MCP authorization attempts |
| `mcp_server` | Immutable Organization-owned HTTPS endpoints and schema-backed JSONB configuration with encrypted OAuth clients |
| `mcp_connection` | Private TenantUser credentials, one connection per user and server |

Deployment settings, model and sandbox credentials, MCP clients, connection credentials, and pending OAuth attempts use compact JWE with keys derived from `DATABASE_ENCRYPTION_KEY`. Column codecs and explicit storage helpers share the same encryption implementation. Payloads bind secrets to their setting or resource identity, checked after decoding to prevent ciphertext transplantation. Better Auth separately encrypts retained OAuth tokens.

Configuration snapshots, migration state, and sandbox leases are process-local. Restart other replicas after configuration changes. A conversation routed to another replica may receive a fresh sandbox.

### Remote MCP connections

Remote tools use `@tanstack/ai-mcp` over the official MCP HTTP transport, restricted to protocol 2026-07-28 and tool discovery/execution. Each run acquires clients with public HTTPS socket resolution and request-scoped JSON or SSE responses. Clients advertise no optional capabilities. The documented [manual `tools()` API](https://tanstack.com/ai/latest/docs/tools/mcp-manual) keeps bounded discovery and cancellation in the run's Effect scope and supplies declarations to existing history-refresh middleware. TanStack's managed mode is compatible with middleware, but would require extra bridging here. The package converts MCP content and structured results into TanStack tool results and resolves display titles. Standard Schema validates inputs and structured outputs. Original schemas and allowlisted provenance preserve saved titles, and TanStack middleware emits their live presentation event.

Server definitions describe endpoints and authentication settings. Connections hold access credentials. Organization admins currently manage server definitions, and each TenantUser creates a private connection per server. Tenant-managed and user-added definitions, and shared credentials, are deferred. Credentials include immutable Organization, Tenant, user, connection and server identity, checked after decryption. `lock_version` changes on successful reauthorization and credential replacement. Ordinary refresh preserves it, so a discovered tool can reject credential replacement without rejecting token rotation. Disconnect deletes the connection, and a subsequent connection gets a fresh identity. Public connections store no credentials. Endpoints and authentication configuration are immutable. Removing and re-adding a definition requires people to connect again.

One encrypted authorization attempt per connection lives in the existing PostgreSQL cache with a ten-minute TTL. Starting another attempt supersedes the previous one and replaces its browser cookie. The SDK owns discovery, scope selection, registration, token authentication, resource validation, issuer-response validation and PKCE. Application origin, state and browser binding are checked before token exchange. The popup severs its opener before provider navigation. Authenticated completion polls the attempt, checks the owner and lock version, then atomically replaces credentials and consumes it. Automatic registrations are created afresh on reconnect, avoiding stale or revoked application clients. Failed reconnects retain the previous grant. Callback and client metadata URLs use trusted deployment configuration.

Refresh claims a timestamp inside the encrypted credential envelope against the current credential ciphertext and lock version. Token exchange runs outside transactions. Conditional commits prevent stale work from replacing new credentials or undoing disconnect. A rotating response without a replacement refresh token preserves the current grant's refresh token. An expired claim or ambiguous response requires reconnection, without redeeming the old token again. Google authorization requests consent and offline access. Disconnect is local and does not revoke provider-wide grants. Tokens never enter workflow journals or idempotency receipts.

Deterministic fixtures cover protocol, ownership, OAuth and cross-process refresh. Live provider verification is separate. Legacy MCP revisions, stdio, protocol sessions, private networks, subscriptions, resources, prompts, sampling, elicitation and incremental scope authorization are outside this client. The SDK mirrors `x-mcp-header` parameters, while AstralBeam filters invalid declarations and rejects unsafe mirrored values before dispatch. The package ignores `structuredContent` without a declared output schema. Organizations configure required OAuth scopes before connecting. Discovery has response-size, page, time and connection bounds. All discovered tools are exposed without a separate catalog allocator, so the model provider's own limits apply to the combined tool set.

To verify live providers, open **MCP connections** in the embedded sidebar, connect to a server, and choose **Test connection**. This lists tools without invoking business tools. See [MCP servers](../platform/src/routes/docs/-content/dashboard/connections.md) for hosted examples.

### Conversation schema choices

Conversation storage uses five Tenant-owned tables with scoped keys. Participants grant access without permanent ownership. Human authorship remains on messages after membership removal.

Only 1:N relationships receive separate tables. Conversations contain participants and messages, messages contain ordered parts, and committed tool-decision parts expect one or more responses. One accepted input currently starts one turn, so its execution fields stay on the user message. One tool call has one decision part, so declaration and routing stay on that part. Response rows point to accepted result messages instead of duplicating outcome, output, or status.

| Reference | Relevant storage choice | Application here |
| --- | --- | --- |
| [OpenCode SQL schema](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/session/sql.ts), [core V2 content](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/schema/src/session-message.ts) | Legacy part rows coexist with V2 content in message JSON. Input admission and context epochs have separate records. | Typed content stays flexible. Our part rows provide foreign-key identities for expected responses. Queues and context epochs remain deferred. |
| [T3 Code projections](https://github.com/pingdotgg/t3code/blob/a1d9d72aefc2a388ea3915956e9d84d279c87da7/apps/server/src/persistence/Migrations/005_Projections.ts) | Transcript, turns, provider sessions, and approvals have distinct responsibilities. | Turn identity differs from invocation identity without adopting a full projection infrastructure. |
| [LibreChat message schema](https://github.com/LibreChat-AI/LibreChat/blob/f10b1d91f1eee3a2c82d5247bf620351486b7c1b/packages/data-schemas/src/schema/message.ts) | Parent references, structured content, and unfinished/error flags remain explicit. | Preserve ancestry, content, and truthful interruption state. |
| [Hazel outbox](https://github.com/HazelChat/hazel/blob/f033d6058021f0cac6a4e461c902122eab32ed91/packages/db/src/schema/message-outbox.ts) | Asynchronous processing has its own claim and processing lifecycle. | Add independent background-work records when execution outlives foreground requests. |
| [Vercel Chatbot schema](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/lib/db/schema.ts) | Chats and message JSON offer a small initial storage model. | Flexible JSON complements relational authorization and ancestry. A small message table alone does not implement multiplayer execution. |

These are inspectable open-source implementation references, not claims about proprietary hosted schemas. Separate parts are an AstralBeam decision, not a requirement inferred from OpenCode V2.

## Configuration

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are the required bootstrap variables. Other settings normally live in `config`, with uppercase environment overrides taking precedence and making corresponding `/configure` fields read-only.

The first encryption-key entry encrypts writes and authenticates the operator. Older entries decrypt existing values during rotation. Unreadable values can be replaced without revealing their contents. See [key rotation and operator access](SETUP.md#configure-the-environment).

`/configure` approves the exact ordered list of pending migration names. The application opens only when configuration is valid and no migrations are pending. There is no persisted setup-complete flag. This lets an operator complete first boot or repair settings through the same interface.

## Server execution

TanStack Start server functions and routes form the framework boundary. Public management and chat APIs share an Effect HttpApi contract. Chat retains AG-UI input and streaming, while management resources use their own schemas and authorization.

All server logic is Effect programs built from services, one module per domain under `platform/src/lib`, composed into a single app layer and run through one `ManagedRuntime` at the framework boundary. Promise-based libraries such as Better Auth, the email providers, and the sandbox SDKs are wrapped once inside the service that owns them. Failures a user should see are typed errors with their own messages, and every other failure is logged once under a reference the user can quote. The [code map](../platform/src/README.md) shows where each piece lives.

The database module owns a `pg` pool for Promise and Better Auth queries and a separate native `@effect/sql-pg` pool for Effect queries. Effect cancellation may release or destroy a client, so sharing that pool previously broke unrelated Better Auth session queries. See [database instructions](../platform/AGENTS.md#database) for the required pool lifecycle.

Transactions on these shared clients automatically carry their connection identity through Effect fiber context and native Promise async context. The guard throws `TransactionNetworkError` before intercepted fetch, HTTP requests and writes, TCP/TLS connection, WebSocket construction, sends and closes, or other database-client operations. Current-connection SQL and nested savepoints remain allowed. An uncaught error triggers the driver's normal rollback. Effect transaction-local configuration reads use that connection and bypass the process cache, preventing uncommitted settings from entering it. Promise transactions reuse the committed configuration cache and fail on a cache miss, requiring configuration to be loaded before entering the transaction.

This guard catches accidental I/O through the installed entry points in every environment. Previously captured transport functions, writes through existing raw sockets, UDP/DNS, subprocesses, workers, replaced contexts, fresh Effect root runners started inside an Effect transaction, raw Effect SQL runners without the shared statement guard, and PostgreSQL server extensions remain outside its coverage. Detached work must not outlive a transaction. Catching a guard error does not force rollback. Transactions started with raw BEGIN/COMMIT, including the shared migration executor, are not instrumented. Hard isolation requires a separate restricted execution boundary.

## Durable workflow execution

Each platform process embeds `ClusterWorkflowEngine` and one Effect Cluster runner using private HTTP, PostgreSQL journals and SQL row leases compatible with PgBouncer transaction pooling. The runner shares the native Effect pool but has its own scope, keeping startup failures independent of `/configure` and ordinary database operations.

Effect manages its `effect_cluster_*` tables outside Drizzle. Nitro drains HTTP before closing the runner and database pools. See the [cluster guide](../platform/src/lib/cluster/README.md) for lifecycle and storage ownership, and the [workflow guide](../platform/src/lib/workflows/README.md) for authoring and recovery.

## SDK boundary

The vanilla entry lazily loads a widget with its own React and styles. The React entry uses the host's React. Both build on the framework-free headless core, which owns authentication, transport, tool execution, and transcript state.

Chat and directory components use the same framework-free authentication lifecycle for token acquisition, current-user synchronization, proactive renewal, and bounded retry. Each component owns and disposes its session.

Host tools and widgets execute in the host page with agent-chosen input. Attachments stay at user/tool authority, never in system prompts. Sandbox publication copies and verifies bytes in private file storage, then attaches the file to its assistant message. Downloads check current conversation permissions. These boundaries are detailed in [SDK security](../platform/src/routes/docs/-content/sdk/security.md).

## Build and deployment

The platform compiles to a Bun binary with an out-of-tree startup, asset and shutdown check. The SDK publishes independently. The CLI bundles the SDK's API client, token minting, and headless chat session, and releases in lockstep with the SDK as an npm package and cross-compiled Bun binaries. `website` deploys as static assets. CI validates each project. The deterministic browser suites run locally after PR creation and every push to a PR. Model-driven tests require separate credentials and spend credits.

Commands and build constraints belong to each project's instructions and manifests. The [local development guide](SETUP.md#local-development) launches the applications, and the [browser-suite guide](../examples/todos/e2e/README.md) explains test selection and evidence capture.

## Glossary

- **Organization**: an AstralBeam customer, usually a SaaS app.
- **Organization user**: an employee who uses the dashboard through a Better Auth membership.
- **Tenant**: one of the Organization's customers, identified by its chosen external ID.
- **TenantUser**: a Tenant's user, identified by a tenant-local external ID.
- **Chat auth token**: the short-lived JWT the host issues for a tenant user.
- **Attachment**: a user-supplied file included in a chat request.
- **Artifact**: a sandbox file copied to private storage and attached to its publishing message.

## Saved conversations

Every chat uses participant-authorized saved threads. The [chat persistence guide](../platform/src/lib/chat/README.md) covers the schema, execution lifecycle, SDK and HTTP workflows, and failure behavior.

Execution remains attached to its foreground request. Process crashes can leave unfinished turns indefinitely, and `writer_active` reports saved state rather than confirmed process liveness. Unfinished turns do not block new sends. Reopening history never executes stored business calls. Stream replay and automatic execution recovery remain unavailable.

## Known hosted runtime limits

Sandbox identity includes the configured provider connection and authenticated principal. Each process reserves at most 25 leases before provisioning, protects active runs, and expires workspaces 15 minutes after the final run closes. Reported deletion failures retain their lease for retry. Cleanup remains best effort: abrupt process termination loses these records, and the installed Docker, Daytona, and Vercel adapters suppress deletion errors. Guaranteed eventual cleanup would require provider expiry or external reconciliation.

Known regular-file artifact sizes are checked before transfer and bytes are checked again before publication. File changes can race that metadata check. Other sandbox reads and command output are buffered before truncation, and wrapper timeouts may not stop transfers. Office parsing bounds archive bytes and entries, and XLSX parsing caps cells, rows, and columns per sheet. Worksheet text still renders synchronously before truncation without a document-wide render budget. These paths can exhaust replica resources.

Management APIs lack application body, name, and metadata budgets. Their schemas can accept NUL or ill-formed Unicode that PostgreSQL rejects as internal failures. Ingress limits and client-address forwarding require hosted verification.

After a safe provider `RUN_ERROR`, failed managed delivery can make `chatRunResponse` append a generic error that replaces the actionable widget message. This remains unfixed, and failed persistence still withholds the saved acknowledgment.
