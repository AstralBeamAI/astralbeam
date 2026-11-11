import {
  convertMessagesToModelMessages,
  EventType,
  maxIterations,
  mergeAgentTools,
  type StreamChunk,
  type TokenUsage,
} from "@tanstack/ai"
import { chat } from "@tanstack/ai-effect"
import { otelMiddleware } from "@tanstack/ai/middlewares/otel"
import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import { Context, Effect, Layer, Option, Stream } from "effect"

import { McpTools } from "@/lib/mcp/tools.server"
import { redactSensitiveValue } from "@/lib/redaction"
import { ChatThreads, type MessageRecord } from "./threads/threads"
import { ChatThreadInvalid, type ChatThreadError } from "./threads/errors"
import {
  projectChatModelHistory,
  projectChatPublicHistory,
  chatStoredJson,
} from "./threads/projection"
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
import { ChatCompactionError, chatCompactionMessages } from "./compaction"
import {
  chatCompactionContextKey,
  chatCompactionKey,
  selectChatCompaction,
  createChatCompactionMiddleware,
  chatCompactionOutputOptions,
  type ChatCompactionState,
} from "./compaction-middleware"
import { createChatAdapter } from "./adapter"
import { chatWebTools } from "./web"
import { createChatAttachmentTools } from "./attachments/tools"
import {
  createChatAttachmentSnapshotMiddleware,
  ChatFiles,
  type ChatFileScope,
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
import type { ChatMessages, ChatParams, ChatPrincipal } from "./types"
import { IS_DEVELOPMENT_SERVER } from "@/lib/runtime/environment.server"
import { errorReason } from "@/lib/runtime/failure-report.server"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { chatUsageLimitGuard } from "./usage-limits"

// Only recognized provider codes get actionable copy. Provider messages can contain credentials.
const modelErrorMessages: Readonly<Record<string, string>> = {
  compaction_usage_limit:
    "The conversation’s usage limit has been reached. Try again after it resets.",
  compaction_limits:
    "This agent’s model needs token limits to continue long conversations. Ask the site owner to configure them.",
  compaction_context_full:
    "This conversation cannot fit safely. Finish pending actions, shorten the input, or start a new conversation.",
  compaction_instructions:
    "This agent’s instructions and tools exceed its model’s context limit. Ask the site owner to adjust the agent.",
  compaction_failed:
    "Conversation context could not be prepared. Try again or start a new conversation.",
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

const prepareChatHistory = Effect.fnUntraced(function* ({
  history,
  model,
  scope,
  files,
  webAccessEnabled,
  sandboxEnabled,
  contextKey,
  coveredThroughMessageId,
  deferAll = false,
}: {
  readonly history: readonly MessageRecord[]
  readonly model: ChatModelConfiguration
  readonly files: typeof ChatFiles.Service
  readonly webAccessEnabled: boolean
  readonly sandboxEnabled: boolean
  readonly contextKey?: string | undefined
  readonly coveredThroughMessageId?: string | undefined
  readonly deferAll?: boolean
  readonly scope: Pick<ChatFileScope, "organizationId" | "tenantId" | "threadId">
}) {
  const stored = yield* Effect.try({
    try: () =>
      projectChatModelHistory(history, {
        providerId: model.providerId,
        protocol: model.api,
        modelId: model.modelId,
        webAccessEnabled,
        contextKey,
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
  const covered = new Set(
    history
      .slice(0, history.findIndex((message) => message.id === coveredThroughMessageId) + 1)
      .map(({ id }) => id),
  )
  const deferred = (message: (typeof executable)[number]) =>
    deferAll || covered.has(message.id?.split(":")[0] ?? "")
  const hydrated = yield* files.hydrate({
    scope,
    messages: executable.filter((message) => !deferred(message)),
  })
  let index = 0
  const projected = executable.map((message) => (deferred(message) ? message : hydrated[index++]!))
  const deferredParts = new Set<unknown>(
    executable.flatMap((message) =>
      deferred(message) && message.role === "user" && Array.isArray(message.content)
        ? message.content
        : [],
    ),
  )
  const execute = Effect.runPromiseWith(yield* Effect.context<never>())
  const normalized = normalizeChatAttachments(projected, {
    contentShape: "model",
    includeNativeFiles: sandboxEnabled,
    deferFile: (entry) =>
      deferredParts.has(entry)
        ? (signal) =>
            execute(
              Effect.gen(function* () {
                const message = { role: "user" as const, content: [entry] }
                const hydrated = yield* files.hydrate({
                  scope,
                  messages: [message as (typeof executable)[number]],
                })
                const result = normalizeChatAttachments(hydrated, {
                  contentShape: "model",
                  includeNativeFiles: true,
                })
                const file = result.files[0]
                if (
                  !file ||
                  "load" in file ||
                  result.attachments.some((a) => a.result === "rejected")
                )
                  return yield* new ChatThreadInvalid()
                return file
              }),
              { signal },
            )
        : undefined,
  })
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
          webAccessEnabled: agent.webAccessEnabled,
          sandboxEnabled: agent.sandboxProviderId !== null,
          deferAll: agent.compactionEnabled,
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
            if (agent.compactionEnabled && !pricing)
              return Stream.succeed<StreamChunk>({
                type: EventType.RUN_ERROR,
                code: "compaction_limits",
                message: "compaction_limits",
              })
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
                      .pipe(Effect.catch(() => Effect.undefined)),
                })
              : []
            if (log && sandboxTools.length > 0) {
              yield* log("sandbox", `${sandboxTools.length} sandbox tools declared`)
            }
            const collectTools = () =>
              unknownOutcome
                ? webTools
                : mergeAgentTools(
                    [
                      ...webTools,
                      ...mcp.tools,
                      ...sandboxTools,
                      ...createChatAttachmentTools(files, { sandbox: Boolean(session) }),
                    ],
                    params.tools,
                  )
            const tools = [...collectTools()]
            const execute = Effect.runPromiseWith(services)
            const compactionState: ChatCompactionState = {
              history,
              claim: input.managed.claim,
              compatibilityKey: chatCompactionKey(model, systemPrompts, tools),
            }
            let usageFailure: { cause: unknown } | undefined
            const beforeModelCall = async () => {
              if (usageFailure) throw usageFailure.cause
              await execute(threads.assertActive({ claim: compactionState.claim }))
              if (usageLimitGuard && !(await usageLimitGuard.check()))
                throw new ChatCompactionError({ code: "compaction_usage_limit" })
            }
            const recordCompactionUsage = async (usage: TokenUsage) => {
              compactionState.usage = chatStoredJson(usage)
              try {
                await usageLimitGuard?.record(usage)
              } catch (cause) {
                usageFailure = { cause }
                throw cause
              }
              await execute(Effect.logInfo("Conversation compaction usage", usage))
            }
            const projectCompactionSuffix = async (prepared?: ChatMessages) => {
              const start =
                compactionState.history.findIndex(
                  (message) => message.id === compactionState.artifact?.coveredThroughMessageId,
                ) + 1
              const normalized = prepared
                ? { messages: prepared }
                : await execute(
                    prepareChatHistory({
                      history: compactionState.history,
                      files: storedFiles,
                      model,
                      contextKey: chatCompactionContextKey(compactionState),
                      coveredThroughMessageId: compactionState.artifact?.coveredThroughMessageId,
                      sandboxEnabled: agent.sandboxProviderId !== null,
                      webAccessEnabled: agent.webAccessEnabled,
                      scope: {
                        ...input.managed.claim.scope,
                        threadId: input.managed.claim.threadId,
                      },
                    }),
                  )
              // Metadata from the prefix reserves names without reading compacted file bytes.
              const suffix = new Set(compactionState.history.slice(start).map(({ id }) => id))
              return convertMessagesToModelMessages(normalized.messages).filter((message) =>
                suffix.has(message.id?.split(":")[0] ?? ""),
              )
            }
            const adapter = createChatAdapter(
              model,
              agent.compactionEnabled ? recordCompactionUsage : undefined,
            )
            const compaction =
              agent.compactionEnabled && pricing
                ? createChatCompactionMiddleware({
                    state: compactionState,
                    adapter,
                    summaryAdapter: createChatAdapter(model),
                    native:
                      !agent.webAccessEnabled &&
                      ((model.providerType === "openai" &&
                        model.api === "responses" &&
                        new URL(model.baseUrl).origin === "https://api.openai.com") ||
                        (model.providerType === "anthropic" &&
                          model.api === "anthropic-messages" &&
                          new URL(model.baseUrl).origin === "https://api.anthropic.com")),
                    configuration: pricing,
                    summaryOptions: chatCompactionOutputOptions(
                      model,
                      Math.min(pricing.outputCap, 4096),
                    ),
                    onUsage: recordCompactionUsage,
                    onMetrics: (metrics) =>
                      execute(Effect.logInfo("Conversation context", metrics)),
                    beforeCall: beforeModelCall,
                    projectSuffix: projectCompactionSuffix,
                    save: (anchor, payload) =>
                      execute(
                        threads.saveCompaction({
                          claim: compactionState.claim,
                          leafMessageId: compactionState.history.at(-1)!.id,
                          artifact: {
                            coveredThroughMessageId: anchor,
                            compatibilityKey: compactionState.compatibilityKey,
                            payload,
                            usage: compactionState.usage ?? {},
                          },
                        }),
                      ),
                  })
                : undefined
            const managed = managedChatMiddleware({
              managed: input.managed,
              threads,
              history: convertMessagesToModelMessages(messages),
              tools,
              model,
              pricing,
              publicHistory: projectChatPublicHistory(history),
              contextKey: () => chatCompactionContextKey(compactionState),
              agentId: `agent_${input.principal.organization.id}_${agent.id}`,
              execute,
              refreshContext: (claim) =>
                execute(
                  Effect.gen(function* () {
                    const saved = yield* threads.history({
                      scope: claim.scope,
                      id: claim.threadId,
                    })
                    compactionState.history = saved
                    compactionState.claim = claim
                    let normalized = yield* prepareChatHistory({
                      history: saved,
                      files: storedFiles,
                      scope: { ...claim.scope, threadId: claim.threadId },
                      model,
                      webAccessEnabled: agent.webAccessEnabled,
                      sandboxEnabled: agent.sandboxProviderId !== null,
                      deferAll: agent.compactionEnabled,
                    })
                    files.splice(0, files.length, ...normalized.files)
                    tools.splice(0, tools.length, ...collectTools())
                    if (files.length && !systemPrompts.includes(CHAT_ATTACHMENT_SYSTEM_PROMPT))
                      systemPrompts.splice(1, 0, CHAT_ATTACHMENT_SYSTEM_PROMPT)
                    compactionState.compatibilityKey = chatCompactionKey(
                      model,
                      systemPrompts,
                      tools,
                    )
                    if (agent.compactionEnabled)
                      selectChatCompaction(
                        compactionState,
                        yield* threads.compactions({
                          scope: claim.scope,
                          id: claim.threadId,
                        }),
                      )
                    if (agent.compactionEnabled) {
                      normalized = yield* prepareChatHistory({
                        history: saved,
                        files: storedFiles,
                        scope: { ...claim.scope, threadId: claim.threadId },
                        model,
                        webAccessEnabled: agent.webAccessEnabled,
                        sandboxEnabled: agent.sandboxProviderId !== null,
                        coveredThroughMessageId: compactionState.artifact?.coveredThroughMessageId,
                        contextKey: chatCompactionContextKey(compactionState),
                      })
                      files.splice(0, files.length, ...normalized.files)
                      tools.splice(0, tools.length, ...collectTools())
                    }
                    inputMessages.splice(0, inputMessages.length, ...normalized.projected)
                    if (session) yield* session.prepareUploads(files)
                    const providerMessages = compactionState.artifact
                      ? [
                          ...chatCompactionMessages(compactionState.artifact.payload),
                          ...(yield* Effect.promise(() =>
                            projectCompactionSuffix(normalized.messages),
                          )),
                        ]
                      : convertMessagesToModelMessages(normalized.messages)
                    return {
                      providerMessages,
                      publicHistory: projectChatPublicHistory(saved),
                      tools,
                      systemPrompts,
                    }
                  }),
                ),
            })
            turn = managed.state
            const accounting = [
              ...Option.toArray(yield* Effect.serviceOption(OtelTracer.OtelTracer)).map((tracer) =>
                otelMiddleware({
                  tracer,
                  captureContent: true,
                  redact: (text) => redactSensitiveValue("", text),
                  attributeEnricher: () => ({
                    "gen_ai.conversation.id": params.threadId,
                    "gen_ai.agent.id": agent.id,
                  }),
                }),
              ),
              ...managed.middleware,
              ...(usageLimitGuard ? [usageLimitGuard.middleware] : []),
            ]
            const source = chat({
              adapter,
              ...(agent.compactionEnabled && pricing
                ? { modelOptions: chatCompactionOutputOptions(model, pricing.outputCap) }
                : {}),
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
                createChatAttachmentSnapshotMiddleware(inputMessages, history),
                ...accounting,
                ...(compaction ? [compaction] : []),
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
              ...(model.providerType === "openai" &&
                model.api === "responses" && { reasoning: "high" }),
            })
            const delivered = managedChatDelivery({
              source,
              managed: input.managed,
              state: managed.state,
            }).pipe(
              Stream.catchTag("AIError", (error) =>
                error.cause instanceof ChatCompactionError
                  ? Stream.succeed<StreamChunk>({
                      type: EventType.RUN_ERROR,
                      code: error.cause.code,
                      message: error.cause.code,
                    })
                  : Stream.die(error),
              ),
            )
            return usageLimitGuard ? usageLimitGuard.announce(delivered) : delivered
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
                  // Keep the provider's ID separate from the HTTP request ID inherited by these logs.
                  ...(typeof chunk.metadata?.tanstack?.requestId === "string"
                    ? { providerRequestId: chunk.metadata.tanstack.requestId.slice(0, 256) }
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
