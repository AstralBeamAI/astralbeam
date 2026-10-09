# Architecture

AstralBeam lets an Organization embed an agent in its product. Organization employees configure it in the dashboard. The Organization's server authenticates its Tenants and tenant users, then issues short-lived tokens for the embedded SDK.

Implementation rules live in [AGENTS.md](AGENTS.md) and its project-specific counterparts. See [Setup](SETUP.md) for deployment and local development.

## The projects

| Project | Responsibility | Output |
| --- | --- | --- |
| `platform` | Dashboard, `/configure`, `/docs`, management APIs, and chat execution | Deno binary |
| `sdk` | Widget, headless session, React bindings, and token minting | `@astralbeam/sdk` npm package |
| `cli` | Organization admin commands over the public API, built on the SDK | `@astralbeam/cli` npm package and Deno binaries |
| `www` | Prerendered TanStack Start website | Cloudflare assets |
| `examples/todos` | Standalone SDK consumer and browser tests | Demo application |
| `examples/linearity-react` | Project-tracking playground with browser state, Astro tools, and Basic Auth | Deno server and browser assets |
| `examples/todos-rails` | Rails consumer of the SDK from jsDelivr, outside the Deno toolchain | Demo application |

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
│                    └─ Publish artifact → signed download ticket
└─ Receive AG-UI events over Server-Sent Events
```

## Identity and tenancy

Dashboard identity and embedded-chat identity are separate. Better Auth owns dashboard users, accounts, sessions, memberships, invitations, and organization API keys. Tenant users have no AstralBeam login.

An organization API key is `key_<organizationId>_<id>_abo_<secret>`. Its IDs are immutable UUIDs. Only `organization` stores a slug, used for dashboard URLs. Agent public IDs are `agent_<organizationId>_<id>`.

The host signs chat JWTs using the SHA-256 digest of the complete `abo_<secret>` value. AstralBeam verifies them against the stored digest without receiving the raw key. Consequently, read access to `api_key.key` is enough to forge chat tokens. Treat it as signing-key access.

JWTs carry separate `user` and `tenant` claims, use the organization UUID as issuer and `astralbeam` as audience, and expire after 60–600 seconds. Trusted organization context comes from the verified key row. The [chat authentication instructions](platform/src/lib/chat/AGENTS.md#authentication) define verification order and lifecycle checks.

The management API persists Tenants and TenantUsers. Before becoming ready, SDK authentication calls JWT-only `POST /api/v1/me` to synchronize the signed Tenant and current TenantUser atomically. Organization JWTs instead return the existing member and current role. Token issuance does not write these identities. Chat resolves existing internal identities and participant grants without provisioning them. A signed `user.admin` claim grants scoped management access independently of stored TenantUser `admin` data. See [API authentication](platform/src/routes/docs/-content/api/authentication.md).

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
| `chat_thread`, `chat_participant`, `chat_message`, `chat_message_part`, `chat_tool_response` | Shared history, ancestry, turn claims, structured content, and expected tool responses |
| `config` | Encrypted deployment settings |
| `rate_limit` | Shared authentication, setup, and API counters |

The application encrypts `config.value` and `sandbox_provider.credentials` through the Drizzle column codec. Compact JWE uses keys derived from `DATABASE_ENCRYPTION_KEY`. Payloads include row identity, checked after decoding to prevent ciphertext transplantation. Better Auth separately encrypts retained OAuth tokens.

Configuration snapshots, migration state, and sandbox leases are process-local. Restart other replicas after configuration changes. A conversation routed to another replica may receive a fresh sandbox.

### Conversation schema choices

Conversation storage uses five Tenant-owned tables: `chat_thread` has 9 columns, `chat_participant` has 8, `chat_message` has 13, `chat_message_part` has 10, and `chat_tool_response` has 10. All have Organization/Tenant-scoped keys and `timestamps()`. Participants grant access without permanent ownership. Human authorship remains on messages after membership removal.

Only 1:N relationships receive separate tables. Conversations contain participants and messages, messages contain ordered parts, and committed tool-decision parts expect one or more responses. One accepted input currently starts one turn, so its execution fields stay on the user message. One tool call has one decision part, so declaration and routing stay on that part. Response rows point to accepted result messages instead of duplicating outcome, output, or status.

| Reference | Relevant storage choice | Application here |
| --- | --- | --- |
| [OpenCode SQL schema](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/core/src/session/sql.ts), [core V2 content](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/schema/src/session-message.ts) | Legacy part rows coexist with V2 content in message JSON. Input admission and context epochs have separate records. | Typed content stays flexible. Our part rows provide foreign-key identities for expected responses. Queues and context epochs remain deferred. |
| [T3 Code projections](https://github.com/pingdotgg/t3code/blob/a1d9d72aefc2a388ea3915956e9d84d279c87da7/apps/server/src/persistence/Migrations/005_Projections.ts) | Transcript, turns, provider sessions, and approvals have distinct responsibilities. | Turn identity differs from invocation identity without adopting a full projection infrastructure. |
| [LibreChat message schema](https://github.com/LibreChat-AI/LibreChat/blob/f10b1d91f1eee3a2c82d5247bf620351486b7c1b/packages/data-schemas/src/schema/message.ts) | Parent references, structured content, and unfinished/error flags remain explicit. | Preserve ancestry, content, and truthful interruption state. |
| [Hazel outbox](https://github.com/HazelChat/hazel/blob/f033d6058021f0cac6a4e461c902122eab32ed91/packages/db/src/schema/message-outbox.ts) | Asynchronous processing has its own claim and processing lifecycle. | Add independent background-work records when execution outlives foreground requests. |
| [Vercel Chatbot schema](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/lib/db/schema.ts) | Chats and message JSON offer a small initial storage model. | Flexible JSON complements relational authorization and ancestry. A small message table alone does not implement multiplayer execution. |

These are inspectable open-source implementation references, not claims about proprietary hosted schemas. Separate parts are an AstralBeam decision, not a requirement inferred from OpenCode V2.

`current_leaf_message_id` selects the default parent-linked path. UUIDs and timestamps do not order messages. `updated_at` orders thread activity, including message appends, renames, and participant changes. Token checkpoints update messages rather than threads. `lock_version` protects metadata and membership commands. Sends append under a short conversation lock without a client revision or conversation-wide execution claim.

An initiating user message holds `turn_state` and its current server-generated invocation ID in metadata. Generated messages reference that input separately from transcript ancestry and retain the executing participant in provenance. Producer writes verify both invocation identity and current participant permission. Only one assistant draft exists per turn.

Message metadata stores allowlisted provenance, opaque provider continuation, invocation correlation, and client tool declarations. Part JSON stores structured content, original uploads, and immutable tool declarations, with stable part IDs and routing held in columns. Both JSON contracts embed their format version and use Effect Schema codecs for Drizzle writes, ordinary reads, and relational reads. Raw SQL bypasses codecs and explicitly maintains `updated_at`.

A tool response row exists before execution or delivery. Server and sandbox calls have one untargeted slot. Browser calls bind a slot to the initiating participant and browser instance. Result messages record actual authorship and success, failure, skip, or unknown outcome. Every expected slot must receive a result before continuation, so no separate completion-policy field is needed. Multiple slots can represent future fan-out, but client registration and targeted production delivery remain deferred.

## Configuration

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are the required bootstrap variables. Other settings normally live in `config`, with uppercase environment overrides taking precedence and making corresponding `/configure` fields read-only.

The first encryption-key entry encrypts writes and authenticates the operator. Older entries decrypt existing values during rotation. Unreadable values can be replaced without revealing their contents. See [key rotation and operator access](SETUP.md#configure-the-environment).

`/configure` approves migrations by exact name and digest. The application opens only when configuration is valid and no migrations are pending. There is no persisted setup-complete flag. This lets an operator complete first boot or repair settings through the same interface.

## Server execution

TanStack Start server functions and routes form the framework boundary. Public management and chat APIs share an Effect HttpApi contract. Chat retains AG-UI input and streaming, while management resources use their own schemas and authorization.

All server logic is Effect programs built from services, one module per domain under `platform/src/lib`, composed into a single app layer and run through one `ManagedRuntime` at the framework boundary. Promise-based libraries such as Better Auth, the email providers, and the sandbox SDKs are wrapped once inside the service that owns them. Failures a user should see are typed errors with their own messages, and every other failure is logged once under a reference the user can quote. The [code map](platform/src/README.md) shows where each piece lives.

The database module owns a `pg` pool for Promise and Better Auth queries and a separate native `@effect/sql-pg` pool for Effect queries. Effect cancellation may release or destroy a client, so sharing that pool previously broke unrelated Better Auth session queries. See [database instructions](platform/AGENTS.md#database) for the required pool lifecycle.

Transactions on these shared clients automatically carry their connection identity through Effect fiber context and native Promise async context. The guard throws `TransactionNetworkError` before intercepted fetch, HTTP requests and writes, TCP/TLS connection, WebSocket construction, sends and closes, or other database-client operations. Current-connection SQL and nested savepoints remain allowed. An uncaught error triggers the driver's normal rollback. Effect transaction-local configuration reads use that connection and bypass the process cache, preventing uncommitted settings from entering it. Promise transactions reuse the committed configuration cache and fail on a cache miss, requiring configuration to be loaded before entering the transaction.

This guard catches accidental I/O through the installed entry points in every environment. Previously captured transport functions, writes through existing raw sockets, UDP/DNS, subprocesses, workers, replaced contexts, fresh Effect root runners started inside an Effect transaction, raw Effect SQL runners without the shared statement guard, and PostgreSQL server extensions remain outside its coverage. Detached work must not outlive a transaction. Catching a guard error does not force rollback. Transactions started with raw BEGIN/COMMIT, including the shared migration executor, are not instrumented. Hard isolation requires a separate restricted execution boundary.

## Durable workflow execution

Each platform process embeds `ClusterWorkflowEngine` and one Effect Cluster runner using private HTTP, PostgreSQL journals and SQL row leases compatible with PgBouncer transaction pooling. The runner shares the native Effect pool but has its own scope, keeping startup failures independent of `/configure` and ordinary database operations.

Effect manages its `effect_cluster_*` tables outside Drizzle. Nitro drains HTTP before closing the runner and database pools. See the [cluster guide](platform/src/lib/cluster/README.md) for lifecycle and storage ownership, and the [workflow guide](platform/src/lib/workflows/README.md) for authoring and recovery.

When chat moves to Effect workflows, atomically commit input admission and workflow submission through the same native SQL transaction. Give each initiating turn a stable, versioned workflow identity. Checkpoint exact model decisions and individual tool outcomes separately, and use durable deferreds for browser waits and durable clocks for deadlines. Propagate cancellation and participant revocation, guard transcript writes against superseded execution, and require downstream idempotency or reconciliation for external mutations. Wrapping the entire chat loop in one activity is insufficient to recover completed sibling tools safely.

## SDK boundary

The vanilla entry lazily loads a widget with its own React and styles. The React entry uses the host's React. Both build on the framework-free headless core, which owns authentication, transport, tool execution, and transcript state.

Chat and directory components use the same framework-free authentication lifecycle for token acquisition, current-user synchronization, proactive renewal, and bounded retry. Each component owns and disposes its session.

Host definitions use keyed tool and widget registries, object input and output schemas, advisory annotations, and model/app visibility. SDK execution validates input and structured results while keeping functions local. Internal declarations serialize the schema and presentation association independently of those functions. Native DOM and React renderers consume invocation context and controls. Standalone widgets become schema-specific presentation tools.

The SDK constructs result envelopes from plain tool data. Local widget calls validate the same input and output contracts, then return the tool's data or custom result directly. Only `toolResult(...)` marks custom envelopes, so business field names never select a result format. Tool results separate model-safe content and structured data from `uiData`. Versioned results retain the full presentation data in saved JSON, and model projection strips `uiData` from ordinary, partial, and aggregated exchanges. Unversioned results remain unchanged. Existing `render_widget` history is restored without business execution. This prepares protocol adapters without implementing [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) resources, sandboxed frames, or [WebMCP](https://webmachinelearning.github.io/webmcp/) discovery.

Host tools and widgets execute in the host page with agent-chosen input. Attachments stay at user/tool authority, never in system prompts. Sandbox artifacts are downloaded through short-lived tickets bound to the published bytes. These boundaries are detailed in [SDK security](platform/src/routes/docs/-content/sdk/security.md).

## Build and deployment

The platform compiles to a Deno binary with an out-of-tree startup, asset, shutdown, and size check. The SDK publishes independently. The CLI bundles the SDK's API client, token minting, and headless chat session, and releases in lockstep with the SDK as an npm package and cross-compiled Deno binaries. `www` deploys as static assets. CI validates each project. The deterministic browser suites run locally after PR creation and every push to a PR. Model-driven tests require separate credentials and spend credits.

Commands and build constraints belong to each project's instructions and manifests. The [local development guide](CONTRIBUTING.md#local-development) launches local development, and the [browser-suite guide](examples/todos/e2e/README.md) explains test selection and evidence capture.

## Glossary

- **Organization**: an AstralBeam customer, usually a SaaS app.
- **Organization user**: an employee who uses the dashboard through a Better Auth membership.
- **Tenant**: one of the Organization's customers, identified by its chosen external ID.
- **TenantUser**: a Tenant's user, identified by a tenant-local external ID.
- **Chat auth token**: the short-lived JWT the host issues for a tenant user.
- **Attachment**: a user-supplied file included in a chat request.
- **Artifact**: a sandbox file published for download through a signed ticket.

## Saved conversations

Every chat uses saved threads. PostgreSQL stores conversation metadata, participant grants, parent-linked messages, ordered content parts, and expected tool responses. `current_leaf_message_id` identifies the selected path. Messages preserve authorship independently of membership. A participant can read, contribute, or manage according to their role, and no permanent owner field is required.

`ChatThreads` owns database transitions. A short transaction locks the conversation, appends to its current leaf, and advances that leaf. Concurrent participants can submit without an expected conversation version. Parent links establish ordering without message sequences. New input and an assistant draft commit before model preparation. The shared database idempotency helper retains admission receipts for 24 hours in a conversation-scoped namespace, purged on deletion. Replays require current participant authorization and return receipts without restarting generation.

Parent links are the canonical ancestry. History reads traverse parent identities before loading content only for the requested page. Pending-interaction discovery reads outstanding decision parts separately, without loading unrelated content or uploads. Profile complete hydration with long conversations before choosing an optimization. A derived `ltree` path can be added if measured ancestry-query costs justify its storage and maintenance, without changing message identities or the public API.

Each foreground invocation retains its initiating input identity and updates only its own assistant draft. The input’s current metadata invocation ID and assistant provenance fence stale execution without holding database locks during generation. Before every model phase, TanStack’s `providerMessages` middleware receives a consistent projection of current shared history, including interleaved participant input and refreshed attachments. Finishing an earlier draft does not move the current leaf backward. Membership revocation and deletion invalidate affected executions. Explicit unknown-outcome closure invalidates an unfinished invocation before accepting the closure and reserving a continuation.

TanStack drives the model loop through a messages-only persistence adapter. Explicit application gates commit tool decisions before execution, append results before another model phase, and delay executable browser events and saved acknowledgments until commit. Public tool-result fields identify a source message, source part, and response target, derived through response and part relationships. A newly accepted final required response reserves exactly one continuation with a fresh claim. Repeated results recover prior acceptance without restarting generation. Multiple responses become one aggregate provider result in stable response-ID order, while visible history preserves each author’s result. Native streaming checkpoints run approximately once per second through `withPersistence`. Native terminal persistence completion is awaited before application finalization, except at browser waits where that promise remains pending. The application saved acknowledgment covers final content and claim release together.

The SDK uses server-authoritative `ChatClient` hydration and `loadOlderMessages` through an authenticated connection adapter. That adapter translates REST cursors and joins response rows to their decision parts across page boundaries. Native pagination owns transcript prepending. Application state retains participant permissions, pending responses, scoped drafts, and saved widget presentation. Hydration reports no resumable active run until replay is implemented and never executes stored business calls.

Conversation storage does not provide stream replay or execution recovery. Current execution ends with the foreground request. Graceful cancellation saves an interruption, but a process crash can leave drafts and turns marked unfinished indefinitely. `writer_active` reports saved running state, not confirmed process liveness. Unfinished turns do not block new sends. A committed unanswered tool can be explicitly closed as unknown without repeating its external action. Future branches can name other leaves, while forks copy nodes and remap their references. These capabilities build on the existing ancestry without requiring materialized root paths.
