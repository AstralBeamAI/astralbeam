import {
  chat,
  convertMessagesToModelMessages,
  EventType,
  maxIterations,
  mergeAgentTools,
  type StreamChunk,
} from "@tanstack/ai"
import { Context, Effect, identity, Layer, Stream } from "effect"

import { McpTools } from "@/lib/mcp/tools.server"
import { ChatThreads, type MessageRecord } from "./threads/threads"
import { ChatThreadInvalid, type ChatThreadError } from "./threads/errors"
import { projectChatModelHistory, projectChatPublicHistory } from "./threads/projection"
import {
  managedChatDelivery,
  managedChatMiddleware,
  type ManagedChatExecution,
} from "./threads/stream"
import {
  ModelProviders,
  type ChatModelConfiguration,
} from "@/lib/model-providers/model-providers.server"
import { Agents } from "@/lib/agents/agents.server"
import { createChatAdapter } from "./adapter"
import { chatWebTools, chatWebState } from "./web"
import { createChatAttachmentTools } from "./attachments/tools"
import {
  createChatAttachmentSnapshotMiddleware,
  ChatFiles,
  normalizeChatAttachments,
  redactChatAttachmentData,
} from "./attachments/attachments"
import {
  CHAT_ATTACHMENT_SYSTEM_PROMPT,
  CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT,
  CHAT_SANDBOX_SYSTEM_PROMPT,
  CHAT_MAX_MODEL_TURNS,
  CHAT_MCP_PRESENTATION_EVENT,
  CHAT_MODEL_UNAVAILABLE_MESSAGE,
  CHAT_SYSTEM_PROMPT,
} from "./constants"
import { chatDebugLog, chatDebugLogger } from "./debug"
import {
  ChatAgentNotFound,
  ChatDefaultAgentMissing,
  ChatModelMissing,
  ChatModelKeyUnreadable,
  ChatSystemPromptRefused,
  ChatWebAccessUnavailable,
} from "./errors.ts"
import { ChatSandboxes } from "./sandbox/sandbox"
import { createChatSandboxTools } from "./sandbox/tools"
import type { ChatParams, ChatPrincipal } from "./types"
import { IS_DEVELOPMENT_SERVER } from "@/lib/runtime/environment.server"
import { errorReason } from "@/lib/runtime/failure-report.server"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { chatFailedUsageMiddleware, chatUsageLimitGuard } from "./usage-limits"

// Only recognized provider codes get actionable copy. Provider messages can contain credentials.
const modelErrorMessages: Readonly<Record<string, string>> = {
  web_access_unavailable:
    "The provider rejected web access. Ask the site owner to check the model and provider web-tool permissions.",
  invalid_api_key: "The model provider rejected its API key. Ask the site owner to update it.",
  authentication_error:
    "The model provider rejected its credentials. Ask the site owner to check them.",
  insufficient_quota:
    "The model provider has no available quota. Ask the site owner to check billing.",
  rate_limit_exceeded: "The model provider is receiving too many requests. Please try again later.",
  rate_limit_error: "The model provider is receiving too many requests. Please try again later.",
  model_not_found:
    "The configured model is unavailable or access is denied. Ask the site owner to check the model.",
}

/** Dropping the client stream aborts the provider request before closing TanStack's iterator. */
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
      return Stream.fromAsyncIterable(events, identity).pipe(Stream.orDie)
    }),
  )
}

const prepareChatHistory = Effect.fnUntraced(function* ({
  history,
  model,
  sandbox,
  scope,
  files,
  webAccessEnabled,
}: {
  readonly history: readonly MessageRecord[]
  readonly model: ChatModelConfiguration
  readonly files: typeof ChatFiles.Service
  readonly sandbox: boolean
  readonly webAccessEnabled: boolean
  readonly scope: { organizationId: string; tenantId: string; threadId: string }
}) {
  const stored = yield* Effect.try({
    try: () =>
      projectChatModelHistory(history, {
        providerId: model.providerId,
        protocol: model.api,
        modelId: model.modelId,
        webAccessEnabled,
      }),
    catch: () => new ChatThreadInvalid(),
  })
  const executable = stored.flatMap((message) => {
    if (message.role === "user" || !Array.isArray(message.content)) return [message]
    const content = message.content.filter(
      (part) => !["image", "document", "audio", "video"].includes(part.type),
    )
    return content.length ? [{ ...message, content }] : []
  })
  const projected = yield* files.hydrate({ scope, messages: executable })
  const normalized = normalizeChatAttachments(projected, { sandbox })
  if (normalized.attachments.some((attachment) => attachment.result === "rejected"))
    return yield* new ChatThreadInvalid()
  // Admission checks permission for new uploads. Saved uploads remain usable after it changes.
  return { projected, ...normalized }
})

export class Chat extends Context.Service<
  Chat,
  {
    /** Starts one agent run. Pulling the stream drives it, and interrupting it aborts the run. */
    readonly run: (input: {
      readonly params: ChatParams
      readonly principal: ChatPrincipal
      readonly managed: ManagedChatExecution
    }) => Effect.Effect<
      Stream.Stream<StreamChunk>,
      | ChatAgentNotFound
      | ChatDefaultAgentMissing
      | ChatModelMissing
      | ChatModelKeyUnreadable
      | ChatSystemPromptRefused
      | ChatWebAccessUnavailable
      | ChatThreadError
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
      const sandboxes = yield* ChatSandboxes
      const modelProviders = yield* ModelProviders
      const threads = yield* ChatThreads
      const storedFiles = yield* ChatFiles
      const mcpTools = yield* McpTools
      const usageLimits = yield* UsageLimits

      const run = Effect.fn("Chat.run")(function* (input: {
        params: ChatParams
        principal: ChatPrincipal
        managed: ManagedChatExecution
      }) {
        const { params, principal } = input
        yield* threads.assertActive({ claim: input.managed.claim })
        const { agentId, systemPrompt, debug } = params.forwardedProps
        // Instructions are agent configuration: a browser-supplied prompt would let any tenant
        // user rewrite them from devtools, so the endpoint refuses rather than ignores it.
        if (systemPrompt !== undefined && systemPrompt !== null) {
          return yield* new ChatSystemPromptRefused()
        }
        const agent = yield* agents
          .resolveForChat({ organizationId: principal.organization.id, agentId })
          .pipe(
            Effect.mapError(() =>
              agentId === undefined || agentId === null
                ? new ChatDefaultAgentMissing()
                : new ChatAgentNotFound(),
            ),
          )
        const model = yield* modelProviders
          .resolveForAgent({ organizationId: principal.organization.id, agentId: agent.id })
          .pipe(
            Effect.catchTag("ModelProviderUnreadable", () =>
              Effect.fail(new ChatModelKeyUnreadable()),
            ),
          )
        if (!model) return yield* new ChatModelMissing()
        const web = agent.webAccessEnabled ? chatWebState() : undefined
        const webTools = yield* Effect.try({
          try: () => chatWebTools(model, agent.webAccessEnabled, params.tools),
          catch: () => new ChatWebAccessUnavailable(),
        })
        const history = yield* threads.history({
          scope: input.managed.claim.scope,
          id: input.managed.claim.threadId,
          messageId: input.managed.claim.assistantMessageId,
        })
        const {
          projected: inputMessages,
          messages,
          attachments,
          files,
        } = yield* prepareChatHistory({
          history,
          files: storedFiles,
          model,
          sandbox: agent.sandboxProviderId !== null,
          webAccessEnabled: agent.webAccessEnabled,
          scope: { ...input.managed.claim.scope, threadId: input.managed.claim.threadId },
        })
        const unknownOutcome = history.some(
          (message) =>
            message.role === "tool" &&
            message.turnMessageId === input.managed.claim.inputMessageId &&
            message.payload.parts.some((part) => part.outcome === "unknown"),
        )
        // The SDK's `debug` mount option rides along in the forwarded props and its log prints
        // whole conversations, so, like the refused `systemPrompt`, it is honored only in DEV.
        const log = debug === true && IS_DEVELOPMENT_SERVER ? chatDebugLog(params.runId) : undefined
        if (log) {
          yield* log("request", "conversation messages", redactChatAttachmentData(inputMessages))
          yield* log("request", `client-declared tools (${params.tools.length})`, params.tools)
        }
        if (log && attachments.length > 0) {
          yield* log("attachment", `${attachments.length} attachment(s) normalized`, attachments)
        }
        const services = yield* Effect.context<never>()
        const limits = yield* usageLimits.applicable({
          organizationId: principal.organization.id,
          listedIds: principal.usageLimitIds ?? [],
        })
        return Stream.unwrap(
          Effect.gen(function* () {
            let turn = { claim: input.managed.claim }
            yield* Effect.addFinalizer(() =>
              threads
                .interrupt({ claim: turn.claim })
                .pipe(Effect.timeout("5 seconds"), Effect.ignore),
            )
            const pricing = yield* modelProviders.pricing(model)
            const usageLimitGuard = limits.length
              ? chatUsageLimitGuard({
                  usageLimits,
                  limits,
                  subject: { ...input.managed.claim.scope, threadId: input.managed.claim.threadId },
                  pricing,
                  execute: Effect.runPromiseWith(services),
                })
              : undefined
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
            const systemPrompts = [
              CHAT_SYSTEM_PROMPT,
              ...(unknownOutcome
                ? [
                    "An earlier action in this turn has an unknown outcome. It may already have taken effect. Explain the uncertainty and ask the user to verify it before requesting another action. Do not assert failure.",
                  ]
                : []),
              ...(files.length > 0 ? [CHAT_ATTACHMENT_SYSTEM_PROMPT] : []),
              ...(session ? [CHAT_SANDBOX_SYSTEM_PROMPT, CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT] : []),
              agent.systemPrompt,
            ]
            const mcp = unknownOutcome
              ? { tools: [], presentation: [], unavailable: [] }
              : yield* mcpTools.acquire(input.managed.claim.scope)
            const sandboxTools = session
              ? createChatSandboxTools({
                  session,
                  services,
                  publishArtifact: (bytes) =>
                    threads
                      .publishArtifact({ claim: turn.claim, bytes })
                      .pipe(Effect.catch(() => Effect.succeed(undefined))),
                })
              : []
            if (log && sandboxTools.length > 0) {
              yield* log("sandbox", `${sandboxTools.length} sandbox tools declared`)
            }
            const tools = unknownOutcome
              ? webTools
              : [
                  ...mergeAgentTools(
                    [
                      ...webTools,
                      ...mcp.tools,
                      ...sandboxTools,
                      ...createChatAttachmentTools(files),
                    ],
                    params.tools,
                  ),
                ]
            const managed = managedChatMiddleware({
              managed: input.managed,
              threads,
              history: convertMessagesToModelMessages(messages),
              tools,
              model,
              pricing,
              web,
              publicHistory:
                web ||
                history.some((record) =>
                  record.payload.parts.some((part) => part.executionLocation === "provider"),
                )
                  ? projectChatPublicHistory(history)
                  : undefined,
              agentId: `agent_${input.principal.organization.id}_${agent.id}`,
              execute: Effect.runPromiseWith(services),
              refreshContext: (claim) =>
                Effect.runPromiseWith(services)(
                  Effect.gen(function* () {
                    const saved = yield* threads.history({
                      scope: claim.scope,
                      id: claim.threadId,
                    })
                    const normalized = yield* prepareChatHistory({
                      history: saved,
                      files: storedFiles,
                      scope: { ...claim.scope, threadId: claim.threadId },
                      model,
                      sandbox: agent.sandboxProviderId !== null,
                      webAccessEnabled: agent.webAccessEnabled,
                    })
                    files.splice(0, files.length, ...normalized.files)
                    inputMessages.splice(0, inputMessages.length, ...normalized.projected)
                    if (session) yield* session.prepareUploads(files)
                    if (!unknownOutcome)
                      tools.splice(
                        0,
                        tools.length,
                        ...mergeAgentTools(
                          [
                            ...chatWebTools(model, agent.webAccessEnabled, params.tools),
                            ...mcp.tools,
                            ...sandboxTools,
                            ...createChatAttachmentTools(files),
                          ],
                          params.tools,
                        ),
                      )
                    if (files.length && !systemPrompts.includes(CHAT_ATTACHMENT_SYSTEM_PROMPT))
                      systemPrompts.splice(1, 0, CHAT_ATTACHMENT_SYSTEM_PROMPT)
                    return {
                      providerMessages: convertMessagesToModelMessages(normalized.messages),
                      publicHistory:
                        web ||
                        saved.some((record) =>
                          record.payload.parts.some(
                            (part) => part.executionLocation === "provider",
                          ),
                        )
                          ? projectChatPublicHistory(saved)
                          : undefined,
                      tools,
                      systemPrompts,
                    }
                  }),
                ),
            })
            turn = managed.state
            const accounting = [
              ...managed.middleware,
              ...(usageLimitGuard ? [usageLimitGuard.middleware] : []),
            ]
            return chatEventStream((abortController) => {
              const source = chat({
                adapter: createChatAdapter(model, web),
                // Undefined still enables TanStack's default error logger.
                debug: log ? { logger: chatDebugLogger({ runId: params.runId }) } : false,
                messages,
                systemPrompts,
                // Host tools arrive declared in the request body and run in the page. `mergeAgentTools`
                // drops a client tool named like a server tool.
                tools,
                // A sandbox command or publication can depend on an earlier tool's file write.
                // https://github.com/TanStack/ai/blob/main/packages/ai/CHANGELOG.md#0640
                toolExecution: "sequential",
                repairToolInput: false,
                // Interrupt snapshots preserve original uploads after provider normalization.
                middleware: [
                  chatFailedUsageMiddleware(accounting),
                  createChatAttachmentSnapshotMiddleware(inputMessages, history),
                  ...accounting,
                  {
                    name: "mcp-presentation",
                    onStart: (ctx) =>
                      ctx.emitCustomEvent(CHAT_MCP_PRESENTATION_EVENT, {
                        tools: mcp.presentation,
                        unavailable: mcp.unavailable,
                      }),
                  },
                ],
                agentLoopStrategy: maxIterations(CHAT_MAX_MODEL_TURNS),
                threadId: params.threadId,
                runId: params.runId,
                parentRunId: params.parentRunId,
                resume: params.resume,
                // Native OpenAI reasoning models keep main's effort. Other models reject the option.
                ...(model.providerType === "openai" &&
                  model.api === "responses" &&
                  /^(?:gpt-5|o\d)/.test(model.modelId) &&
                  !model.modelId.endsWith("-chat-latest") && {
                    modelOptions: { reasoning: { effort: "high" } },
                  }),
                abortController,
              })
              const delivered = managedChatDelivery({
                source,
                managed: input.managed,
                state: managed.state,
              })
              return usageLimitGuard ? usageLimitGuard.announce(delivered) : delivered
            })
          }),
        ).pipe(
          Stream.mapEffect((chunk): Effect.Effect<StreamChunk> => {
            if (chunk.type !== EventType.RUN_ERROR) return Effect.succeed(chunk)
            // Providers can send their own `aborted` code, so it keeps only TanStack's fixed shape.
            const aborted = chunk.code === "aborted"
            const message = aborted
              ? "Request aborted"
              : Object.hasOwn(modelErrorMessages, chunk.code ?? "")
                ? modelErrorMessages[chunk.code!]!
                : CHAT_MODEL_UNAVAILABLE_MESSAGE
            const runError = {
              type: chunk.type,
              ...(chunk.timestamp === undefined ? {} : { timestamp: chunk.timestamp }),
              ...(chunk.threadId === undefined ? {} : { threadId: chunk.threadId }),
              ...(chunk.runId === undefined ? {} : { runId: chunk.runId }),
              message,
              ...(aborted ? { code: "aborted" } : {}),
            }
            return Effect.as(
              Effect.logWarning("Chat model request failed").pipe(
                Effect.annotateLogs({
                  organizationId: principal.organization.id,
                  providerId: model.providerId,
                  code: errorReason(chunk),
                  ...(typeof chunk.metadata?.tanstack?.errorType === "string"
                    ? { errorType: chunk.metadata.tanstack.errorType.slice(0, 128) }
                    : {}),
                  ...(typeof chunk.metadata?.tanstack?.requestId === "string"
                    ? { requestId: chunk.metadata.tanstack.requestId.slice(0, 256) }
                    : {}),
                }),
              ),
              runError,
            )
          }),
        )
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
    Layer.provide([
      Agents.layer,
      ChatSandboxes.layer,
      ModelProviders.layer,
      ChatThreads.layer,
      ChatFiles.layer,
      McpTools.layer,
      UsageLimits.layer,
    ]),
  )
}
