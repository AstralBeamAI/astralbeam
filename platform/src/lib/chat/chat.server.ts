import { chat, mergeAgentTools, type StreamChunk } from "@tanstack/ai"
import { Cause, Context, Effect, identity, Layer, Stream } from "effect"

import { Database } from "@/db/database.server"
import { DatabaseEncryptionError } from "@/db/lib/encryption.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { Agents } from "@/lib/agents/agents.server"
import { readOrganizationOpenaiApiKey } from "@/lib/organizations/openai-api-key.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { createChatAdapter } from "./adapter.server"
import { createChatAttachmentTools } from "./attachment-tools.server"
import {
  createChatAttachmentSnapshotMiddleware,
  normalizeChatAttachments,
  redactChatAttachmentData,
} from "./attachments.server"
import {
  CHAT_ATTACHMENT_SYSTEM_PROMPT,
  CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT,
  CHAT_SANDBOX_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
} from "./constants.server"
import { chatDebugLog, withChatDebugLog } from "./debug.server"
import {
  ChatAgentNotFound,
  ChatAttachmentsDisabled,
  ChatDefaultAgentMissing,
  ChatModelKeyMissing,
  ChatModelKeyUnreadable,
  ChatSystemPromptRefused,
} from "./errors.ts"
import { ChatSandboxes } from "./sandbox.server"
import { createChatSandboxTools } from "./sandbox-tools.server"
import type { ChatParams, ChatPrincipal } from "./types"
import { IS_DEVELOPMENT_SERVER } from "@/lib/runtime/environment.server"

/**
 * A run's AG-UI events. Interrupting the stream, as a dropped client does, aborts the provider
 * request and then closes TanStack's iterator, so billing stops with the connection.
 */
function chatEventStream(start: (abortController: AbortController) => AsyncIterable<StreamChunk>) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const abortController = new AbortController()
      const iterator = start(abortController)[Symbol.asyncIterator]()
      // Finalizers run last in, first out, and closing the iterator waits for the in-flight
      // provider call, so the abort is registered last and the stream sees no `return` of its own.
      yield* Effect.addFinalizer(() => Effect.promise(() => Promise.resolve(iterator.return?.())))
      yield* Effect.addFinalizer(() => Effect.sync(() => abortController.abort()))
      const events = { [Symbol.asyncIterator]: () => ({ next: () => iterator.next() }) }
      return Stream.fromAsyncIterable(events, identity).pipe(
        // TanStack's SSE encoder turns a thrown iterator into its RUN_ERROR event.
        Stream.orDie,
        Stream.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.void : reportFailure("Chat.run", cause),
        ),
      )
    }),
  )
}

export class Chat extends Context.Service<
  Chat,
  {
    /** Starts one agent run. Pulling the stream drives it, and interrupting it aborts the run. */
    readonly run: (input: {
      readonly params: ChatParams
      readonly principal: ChatPrincipal
    }) => Effect.Effect<
      Stream.Stream<StreamChunk>,
      | ChatAgentNotFound
      | ChatAttachmentsDisabled
      | ChatDefaultAgentMissing
      | ChatModelKeyMissing
      | ChatModelKeyUnreadable
      | ChatSystemPromptRefused
    >
    /** The selected agent's attachment grant, which a client may narrow but never widen. */
    readonly capabilities: (input: {
      readonly principal: ChatPrincipal
      readonly agentId?: string | undefined
    }) => Effect.Effect<{ readonly attachments: boolean }, ChatAgentNotFound>
  }
>()("astralbeam/chat/Chat") {
  static readonly layerNoDeps = Layer.effect(
    Chat,
    Effect.gen(function* () {
      const agents = yield* Agents
      const database = yield* Database
      const sandboxes = yield* ChatSandboxes

      // The widget shows a missing or unreadable organization key to the tenant user as a 503.
      const readModelKey = (organizationId: string) =>
        readOrganizationOpenaiApiKey(organizationId).pipe(
          Effect.provideService(Database, database),
          mapDatabaseErrors(),
          // Seam: a key that fails to decrypt dies in Drizzle's row mapping until its read
          // reports it as typed.
          Effect.catchDefect((defect) =>
            defect instanceof DatabaseEncryptionError
              ? Effect.fail(new ChatModelKeyUnreadable())
              : Effect.die(defect),
          ),
          Effect.catchTag("OrganizationOpenaiApiKeyError", () =>
            Effect.fail(new ChatModelKeyUnreadable()),
          ),
          Effect.tapErrorTag("ChatModelKeyUnreadable", () =>
            Effect.logWarning("Chat model key could not be read").pipe(
              Effect.annotateLogs({ organizationId }),
            ),
          ),
          Effect.flatMap((key) =>
            key ? Effect.succeed(key) : Effect.fail(new ChatModelKeyMissing()),
          ),
        )

      const run = Effect.fn("Chat.run")(function* (input: {
        params: ChatParams
        principal: ChatPrincipal
      }) {
        const { params, principal } = input
        const { agentId, systemPrompt, debug } = params.forwardedProps
        // Instructions are agent configuration: a browser-supplied prompt would let any tenant
        // user rewrite them from devtools, so the endpoint refuses rather than ignores it.
        if (systemPrompt !== undefined && systemPrompt !== null) {
          return yield* new ChatSystemPromptRefused()
        }
        // The key is read beside the agent lookup, and judged after it so an unknown agent wins.
        const [agent, modelKey] = yield* Effect.all(
          [
            agents
              .resolveForChat({ organizationId: principal.organization.id, agentId })
              .pipe(
                Effect.mapError(() =>
                  agentId === undefined || agentId === null
                    ? new ChatDefaultAgentMissing()
                    : new ChatAgentNotFound(),
                ),
              ),
            Effect.result(readModelKey(principal.organization.id)),
          ],
          { concurrency: "unbounded" },
        )
        // The SDK's `debug` mount option rides along in the forwarded props and its log prints
        // whole conversations, so, like the refused `systemPrompt`, it is honored only in DEV.
        const log = debug === true && IS_DEVELOPMENT_SERVER ? chatDebugLog(params.runId) : undefined
        if (log) {
          yield* log("request", `POST /api/v1/chat, ${params.messages.length} messages`, {
            threadId: params.threadId,
            runId: params.runId,
            parentRunId: params.parentRunId,
            resume: params.resume,
            agentId,
            debug,
          })
          yield* log("request", "conversation messages", redactChatAttachmentData(params.messages))
          yield* log("request", `client-declared tools (${params.tools.length})`, params.tools)
        }
        const openaiApiKey = yield* Effect.fromResult(modelKey)
        // Attachments become what the model reads before the run, since the provider adapter throws
        // on a part it cannot map. A file with no text view needs a sandbox to go to.
        const { messages, attachments, files } = normalizeChatAttachments(params.messages, {
          sandbox: agent.sandboxProviderId !== null,
        })
        // Agent capability policy, enforced here regardless of what the client narrowed.
        if (!agent.attachmentsEnabled && attachments.length > 0) {
          return yield* new ChatAttachmentsDisabled()
        }
        if (log && attachments.length > 0) {
          yield* log("attachment", `${attachments.length} attachment(s) normalized`, attachments)
        }
        // Resolving the sandbox provisions nothing. An unreadable configuration drops its tools and
        // prompts together, so the agent never offers a capability it does not have.
        const session = agent.sandboxProviderId
          ? yield* sandboxes
              .session({
                sandboxProviderId: agent.sandboxProviderId,
                agentId: agent.id,
                principal,
                threadId: params.threadId,
                runId: params.runId,
                uploads: files,
              })
              .pipe(Effect.catchTag("ChatSandboxConfigurationUnreadable", () => Effect.void))
          : undefined
        const sandboxTools = session
          ? createChatSandboxTools({ session, services: yield* Effect.context<never>() })
          : []
        if (log && sandboxTools.length > 0) {
          yield* log("sandbox", `${sandboxTools.length} sandbox tools declared`)
        }
        const events = chatEventStream((abortController) =>
          chat({
            adapter: createChatAdapter(openaiApiKey),
            messages,
            systemPrompts: [
              CHAT_SYSTEM_PROMPT,
              // Only the generic policy: what each attached file is reaches the model through
              // `read_attachment`, so nothing a file chose to say lands at deployment authority.
              ...(files.length > 0 ? [CHAT_ATTACHMENT_SYSTEM_PROMPT] : []),
              ...(sandboxTools.length > 0
                ? [CHAT_SANDBOX_SYSTEM_PROMPT, CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT]
                : []),
              agent.systemPrompt,
            ],
            // Host tools arrive declared in the request body and run in the page. `mergeAgentTools`
            // drops a client tool named like a server tool.
            tools: mergeAgentTools(
              [...sandboxTools, ...createChatAttachmentTools(files)],
              params.tools,
            ),
            // The client rebuilds its transcript from the snapshot an interrupt boundary emits,
            // so the turns it sent have to survive the rewrite above.
            middleware: [createChatAttachmentSnapshotMiddleware(params.messages)],
            threadId: params.threadId,
            runId: params.runId,
            parentRunId: params.parentRunId,
            resume: params.resume,
            modelOptions: { reasoning: { effort: "high" } },
            abortController,
          }),
        )
        return log ? events.pipe(withChatDebugLog(log)) : events
      })

      const capabilities = Effect.fn("Chat.capabilities")(function* (input: {
        principal: ChatPrincipal
        agentId?: string | undefined
      }) {
        const agent = yield* agents
          .resolveForChat({
            organizationId: input.principal.organization.id,
            agentId: input.agentId,
          })
          .pipe(Effect.mapError(() => new ChatAgentNotFound()))
        return { attachments: agent.attachmentsEnabled }
      })

      return Chat.of({ run, capabilities })
    }),
  )

  static readonly layer = Chat.layerNoDeps.pipe(
    Layer.provide([Agents.layer, Database.layer, ChatSandboxes.layer]),
  )
}
