# Chat development

Before changing persistence, authorization, or recovery, read the [chat lifecycle and failure contracts](README.md). Chat-domain modules never import from `src/routes`. Routes own HTTP parsing, SSE, headers, and error encoding. Coordinate protocol changes with `sdk/src/core/protocol.ts`.

## Authentication

- Every chat uses participant-authorized saved history. Organization membership and Tenant admin privileges do not grant participant actions. Preserve historical authorship after access changes. Reject caller system prompts, never silently ignore them, and never let client configuration widen agent capabilities.
- Treat the stored API-key digest as a signing secret. Verify signatures and strict bounded claims before rechecking key lifecycle, and derive scope only from the verified principal. Verification and chat never provision identities or consume Better Auth API-key quota. `/me` owns identity synchronization.
- Scope rate limits, sandbox identity, and file ownership by Organization, Tenant, and TenantUser. A browser-supplied thread ID or provider hash is insufficient. Classify rate buckets by validated operation. Enforce usage limits before admission while always saving valid tool results, whose external action may already have occurred.
- Resolve agents and model assignments within the authenticated Organization. Invalid and inaccessible agent IDs remain indistinguishable. Missing or unreadable model configuration fails without falling back to another credential. Keep agent configuration in one lookup.

## Persistence and attachments

- Use shared idempotency after authorization, rechecking permissions, configuration, and uploads on retries. Parent links and `current_leaf_message_id` remain authoritative. Keep short concurrent append transactions without foreground leases or conversation-wide writer ownership, and fence producer writes by invocation, provenance, running state, and current membership.
- Commit decisions and response slots before execution, and final content before saved acknowledgments. Accept one immutable result per slot. Hydration never authorizes business effects, and interrupted or unknown outcomes are never silently retried. Unfinished turns must not block unrelated sends.
- Preserve part IDs and provenance through checkpoints, reordering, and agent deletion. Never drop saved parts. Replay opaque provider context only with the same provider instance, protocol, and model. Otherwise use canonical parts and original uploads with their tool identities.
- Uploads remain uploader-private until admission associates them with a message. Persist scoped file references and hydrate bytes only for execution or authorized downloads. Prepare storage before committing references, recheck ownership in SQL, retain files until conversation or Tenant deletion, and never treat sandbox copies as durable storage.
- Enforce attachment grants and caps on the server across the selected ancestry. Reject the whole turn on normalization refusal, strip media from non-user messages, reject caller-chosen URLs, and preserve previously accepted files after grant changes. Restore original media in snapshots.
- Keep file contents, filenames, and sheet/column names out of system prompts, and append the agent's prompt last. Images/PDFs use provider media parts, other contents use paged tools or sandbox files. Bound archive inflation, worksheet coordinates, document work, and output before allocation. Preserve workbook date systems and timestamp precision.

## Tools

- Host tools execute in the host page, with server names winning collisions. Provision sandboxes only on first use, memoizing provisioning failure for the run. Unreadable sandbox configuration removes its tools and prompts together, without failing ordinary chat. Preserve provisioning progress events.
- Sandbox reuse is process-local. When changing allocation, include provider configuration in workspace identity, reserve capacity before provisioning, and protect active leases. Bound reads, artifacts, and command output during collection, propagate cancellation, and contain published paths against the provider's real workspace root.
- Publish artifacts through verified `StoredFiles` bytes and a short claim-checked commit attaching them to the requesting assistant message. Downloads authorize current conversation access and read storage without reconnecting to the sandbox. Use blob URLs for previews.
- Keep streaming unbuffered and abort the run before closing the upstream iterator on disconnect. Preserve native run/parent-run correlation and reasoning context across tool continuations. Check published upstream support before adding adapter workarounds.
- Honor client debug requests only in development. Redact attachment bytes and diagnostics, never expose credentials, provider errors, or setup details. Use allowlisted safe messages for known failures and the fixed model-unavailable message otherwise, including failures before SSE encoding. Preserve delivered safe errors and withhold saved acknowledgments on persistence failure.
