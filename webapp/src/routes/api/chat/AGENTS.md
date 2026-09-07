# The chat endpoint

`/api/chat` is the only route a tenant user's browser talks to. It authenticates a token the Organization's own server minted, resolves an agent, and streams one agent run back over Server-Sent Events. `sdk/src/core/protocol.ts` is the peer on the client side and names the same tools and events; changing either requires changing both by hand.

## Request arrival

- Three routes live here. `index.ts` streams a run (`POST`), `config.ts` answers the agent capability handshake (`GET`), and `files.ts` serves one published sandbox artifact (`GET`).
- All three answer `OPTIONS` and stamp `corsHeaders` onto every response, errors included. The widget embeds on origins the webapp does not serve, so the allowed origin is `*` — authentication is a bearer header, so there are no cookies to protect — and the allowed request headers are enumerated so a preflight cannot widen the surface.
- A thrown handler error becomes a framework response with no CORS headers, which a cross-origin widget cannot read at all. Every failure path therefore returns `errorResponse`, never a throw.
- `index.ts` refuses before it reads a body: database bootstrap issues give 503, incomplete setup gives `setupGateResponse()`'s 503, and a declared `content-length` over `CHAT_MAX_REQUEST_BYTES` (32 MB) gives 413. `readChatRequestJson` re-counts bytes while streaming, because the header is only a claim.
- `chatParamsFromRequestBody` from `@tanstack/ai` parses the AG-UI run input: messages, the client-declared tools with their schemas, `threadId`/`runId`/`parentRunId`/`resume`, and `forwardedProps`.
- Only `agentId` and `debug` are honored from `forwardedProps`. A `systemPrompt` is refused with 400 rather than ignored, so a tenant user cannot rewrite the agent's instructions from devtools and cannot be misled into believing they did.
- `debug: true` is client-supplied — the SDK's `debug` mount option rides in `forwardedProps` — so it is honoured only when the server runs in development mode (`import.meta.env.DEV`, the same signal the `/dev` routes use) and ignored in production. That lets both sides log one conversation locally without letting any caller make a production replica print conversations to stdout.

## Authentication

- `authenticateChatRequest` in `-lib/auth.server.ts` is the deliberate exception to Better Auth's `verifyApiKey`. The host signs offline, so this endpoint never sees the raw key and uses Better Auth's stored SHA-256 digest as the HMAC verifier. Read access to `api_key.key` is therefore enough to forge a token; treat that column as a signing key.
- The order is the security property. `kid` is parsed as `key_<organizationSlug>_<keySlug>` and used only as a lookup hint; the row is loaded by organization slug plus key slug plus `config_id = "default"`; `jwtVerify` then checks the HS256 signature, `typ`, `iss` (the organization slug), `aud` (`astralbeam`), `iat`/`exp`, a 30-second clock tolerance, and `maxTokenAge`; `protectedHeader.kid` is re-compared against the verified header; the `user` plus `tenant` JSON is size-capped at 8 KiB; `ChatAuthTokenPayloadSchema` decodes with `onExcessProperty: "error"` and pins `ver: 4`; and the lifetime is re-checked to 60–600 seconds.
- Key lifecycle (`enabled`, `expires_at`) is re-read _after_ the signature verifies, in a second query keyed by `(id, organizationId)`. A disabled or expired key fails there, not before.
- Verification is read-only. It never touches `request_count`, `remaining`, the refill columns, or `last_request`, so a chat run does not consume Better Auth API-key quota.
- The trusted context is a `ChatPrincipal`: `organization.id` from the loaded row, plus the token's `user` and `tenant` claims. No organization id ever comes from the request body.
- Rate limiting (`-lib/rate-limit.server.ts`) is 20 requests per 60 seconds against the database-backed limiter, keyed by `chat:` plus `chatPrincipalScope` — a SHA-256 over the JSON tuple `[organizationId, tenantId, tenantUserId]`. The tenant ids are host-supplied external strings, so the JSON tuple is what makes arbitrary text an unambiguous key.
- `tenant` and `tenant_user` rows are not involved: nothing here reads or writes them. Tenancy on this path is the token's claims.

## Agent resolution

- `resolveChatAgent` takes the `agentId` public id (`agent_<uuidv7>`, the agent's own primary key) or, when it is absent, joins `organization_configuration.default_agent_id`. Creating an organization also creates a starter agent and that configuration row, so the default normally exists; when it does not, the 404 says so specifically.
- A malformed id, a non-string id, and an id belonging to another organization all return `null` and the same 404, because the query is additionally filtered by the authenticated organization id. There is no way to tell "not an id" from "not yours".
- The agent row contributes exactly three things: `systemPrompt`, `attachmentsEnabled`, and the optional `sandboxProviderId`. It carries no model — every run uses the single `CHAT_MODEL` constant in `-lib/adapter.server.ts` with the deployment's `openai_api_key` config value.
- System prompts compose in order: `CHAT_SYSTEM_PROMPT`, the attachment policy when the run carries files, the two sandbox prompts when sandbox tools were declared, then the agent's own prompt last. No prompt text ever names a file, sheet, or column: those strings are chosen by whoever made the file, and a system prompt carries deployment authority.

## Attachments

- Files ride inline in the run input as AG-UI media entries (`{ type, source: { type: "data", value, mimeType }, metadata }`) on the user's own message. `normalizeChatAttachments` rewrites those messages into what the model actually receives.
- There are two deliveries. An image or PDF passes through as a provider file part; everything else becomes a _file_ — the user's message keeps one `[Attached: <handle>]` line and the contents reach the agent through `read_attachment` or through code in the sandbox. Nothing is quoted into the user's turn, so a file cannot impersonate the user's instructions, and paging replaces truncation.
- A media entry on any non-user message is stripped, because the provider adapter maps a role it does not recognize as a user turn and would otherwise skip every check here.
- Refusals become one sentence in the transcript the agent can relay: a non-`data` source, an unrecognized kind, a position past `CHAT_ATTACHMENT_MAX_COUNT` files on one message (the peer of the SDK composer's `MAX_ATTACHMENTS_PER_MESSAGE`, which stops there first), a per-kind size over `CHAT_ATTACHMENT_MAX_BYTES_BY_KIND`, the 20 MB run total, a failed magic-byte check, an undecodable payload, invalid UTF-8, or a text-less file with no sandbox to open it in.
- MIME types are normalized, repaired from the file extension for data and office formats only, then checked against `CHAT_ATTACHMENT_MAGIC_BYTES` using the first 24 base64 characters, so a renamed 20 MB file is refused without being decoded.
- Office files are ZIPs, so `-lib/attachment-office.server.ts` filters entries by declared uncompressed size against one archive-wide budget before `unzipSync` inflates anything, and bounds sheet cells, rows, and columns — a worksheet's coordinates are attacker-chosen. `-lib/attachment-profile.server.ts` profiles delimited text; a profile is metadata (columns, inferred types, row counts), never content.
- Nothing is persisted. Decoded bytes live in the run's `files` array for the request only; the client re-sends every past attachment each turn and each run re-reads them. The one durable copy is in the sandbox, written to `uploads/<handle>` as part of starting it.
- `read_attachment` is declared only when the run carries files. It pages the decoded text — `CHAT_ATTACHMENT_READ_MAX_CHARACTERS` per call, clamped whatever the model asks for — and returns type, size, table columns and row counts, and the sandbox path alongside the page.
- `createChatAttachmentSnapshotMiddleware` restores the original media entries in the `MESSAGES_SNAPSHOT` the client rebuilds its transcript from. Without it, a sent file's chip becomes literal `[Attached: …]` text, the bytes leave the client's copy of the turn, and its handles stop resolving on the next request.

## Tools

- Host tools and widgets arrive declared in the request body and execute in the host page. The endpoint forwards them verbatim through `mergeAgentTools`, which drops a client tool whose name collides with a server tool. `render_widget` and `ask_questionnaire` are the two every mount declares.
- Sandbox tools are the exception that executes here: `sandbox_write_file`, `sandbox_read_file`, `sandbox_list_files`, `sandbox_run_command`, and `sandbox_publish_artifact`, declared only when the agent has a `sandboxProviderId` (differs from `webapp/src/lib/sandbox/README.md`, which lists the first four).
- `sdk/src/core/protocol.ts` names the shared literals: `RENDER_WIDGET_TOOL`, `ASK_QUESTIONNAIRE_TOOL`, `SANDBOX_WRITE_FILE_TOOL`, `SANDBOX_READ_FILE_TOOL`, `SANDBOX_LIST_FILES_TOOL`, `SANDBOX_RUN_COMMAND_TOOL`, `SANDBOX_PUBLISH_ARTIFACT_TOOL`, and `SANDBOX_STATUS_EVENT`. The SDK writes them as string literals; this side derives them from `APP_HANDLE` in `-lib/constants.server.ts`.
- No sandbox is provisioned when a run starts. `resolveChatSandboxSession` is one organization-scoped configuration read; the first sandbox tool the agent reaches for calls `acquireChatSandbox`, which memoizes one `ensure` — including its rejection, so a failed provision is not retried per tool call — and writes the run's uploads in.
- Provisioning progress goes out as the `SANDBOX_STATUS_EVENT` CUSTOM event carrying `state: "starting" | "ready" | "error"`. It exists because no tool result can report it in time: the widget needs it while the sandbox is still starting.
- An unreadable provider configuration drops the sandbox tools and their prompts together and logs the reason, so the agent answers without a sandbox instead of the run failing.
- Sandbox leases are process-local, namespaced by `chatPrincipalScope`, swept at 15 minutes idle, and capped at 25 live with LRU eviction. Resume therefore works only within one replica.
- `sandbox_publish_artifact` mints a ticket: an HS256 JWT signed with a key HKDF-derived from the active `DATABASE_ENCRYPTION_KEY`, carrying the principal scope, provider id, vendor sandbox id, path, content-sniffed MIME type, size, and a SHA-256 of the bytes. `files.ts` takes `?ticket=` as the whole capability, because an `<img src>` cannot carry a bearer header; it then resumes (never creates) the sandbox, re-resolves containment, re-reads, re-caps, re-hashes, and re-sniffs. Any mismatch is a 404.

## Streaming

- `chat()` produces the AG-UI event stream and `toServerSentEventsResponse` turns it into the response, with the CORS headers copied on afterwards and an `AbortController` shared so a dropped client aborts the run.
- The events are AG-UI's own: `RUN_STARTED`/`RUN_FINISHED`/`RUN_ERROR`, `TEXT_MESSAGE_*`, `REASONING_MESSAGE_*`, `TOOL_CALL_START`/`ARGS`/`END`/`RESULT`, `MESSAGES_SNAPSHOT`, and CUSTOM.
- A host tool result comes back on a _following request_ rather than on this stream: the client executes the tool in its page, then re-posts the conversation with `runId`, `parentRunId`, and `resume` set. `-lib/adapter.server.ts` drops the OpenAI Responses item id from a replayed `function_call` so it matches on `call_id` alone; without that, a reasoning model rejects the unpaired call and the run fails the moment the first host tool result arrives.
- Debug logging needs both the request's `debug` flag and a development server, so it never runs in production. `withDebugLog` wraps the stream, accumulates text and tool-input deltas and logs them whole on their end event, and `redactChatAttachmentData` replaces every base64 payload with its size before any message is printed.

## Invariants

- The organization id comes only from the loaded API-key row — never from the request body, a claim, or a header.
- Every tenant-scoped key folds in all three of organization id, tenant id, and tenant-user id: the rate-limit key, the sandbox instance-store namespace, and the artifact ticket. `threadId` is browser-supplied and upstream's `computeSandboxKey` is a 64-bit hash, so that key alone is not a tenant boundary.
- The key's `enabled`/`expires_at` read must stay after signature verification. Dropping it lets a revoked key keep working for the remaining lifetime of every token already signed with it.
- An attachment source must stay `data`-only. A URL source would have the model provider fetch a caller-chosen host on this deployment's API key.
- Every attachment cap is enforced here regardless of what the SDK composer already checked, because the caller need not be the SDK.
- Agent instructions and the attachment grant are agent configuration. `/api/chat/config` exists so a client can narrow a grant for UX; it can never widen one, and a client-sent system prompt is refused rather than dropped.
- Sandbox paths are contained against the provider's _real_ workspace root from `resolveHarnessCwd`, and re-checked at download time. Containment is not the security boundary — the sandbox is — but the agent's own files and the widget's file list depend on it.
- Vendor errors never reach the client. `ChatSandboxUnavailableError` and the generic tool refusals replace messages that can carry hostnames or credentials; the real reason goes to the log.
