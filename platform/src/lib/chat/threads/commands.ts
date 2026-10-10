import { convertMessagesToModelMessages, normalizeToUIMessage } from "@tanstack/ai"
import { type Cause, Effect, JsonSchema, Schema, SchemaRepresentation } from "effect"

import { NonEmptyStringSchema } from "@/lib/schemas"
import { ApiUuidSchema } from "@/lib/tenants/schemas"
import { Agents } from "@/lib/agents/agents.server"
import { withDatabaseIdempotency } from "@/db/lib/idempotency"
import { normalizeChatAttachments } from "../attachments/attachments"
import { ChatAttachmentsDisabled, ChatSystemPromptRefused } from "../errors"
import type { ChatParams } from "../types"
import { ChatThreads, type ChatAdmission, type ThreadInput } from "./threads"
import {
  ChatThreadForbidden,
  ChatThreadInvalid,
  ChatThreadNotFound,
  type ChatThreadError,
} from "./errors"
import { chatStoredJson } from "./projection"
import {
  ChatSubmissionReceiptSchema,
  type ChatThreadScope,
  type ChatToolResolution,
} from "./schemas"

const managedChatOptions = Schema.Struct({
  clientId: ApiUuidSchema,
  agentId: Schema.optionalKey(Schema.String),
})
const decodeChatJson = Schema.decodeUnknownEffect(Schema.Json)
const chatQuestionnaireAnswer = Schema.Struct({
  name: Schema.String,
  question: Schema.String,
  answers: Schema.Array(NonEmptyStringSchema),
})
const chatQuestionnaireSkipped = Schema.Struct({
  skipped: Schema.Literal(true),
  answers: Schema.optionalKey(Schema.Array(chatQuestionnaireAnswer).check(Schema.isMaxLength(0))),
})
const chatQuestionnaireOutput = Schema.Union([
  Schema.Struct({ answers: Schema.Array(chatQuestionnaireAnswer).check(Schema.isMinLength(1)) }),
  chatQuestionnaireSkipped,
])
const chatQuestionnaireArguments = Schema.fromJsonString(
  Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        title: Schema.String,
        required: Schema.optionalKey(Schema.Boolean),
        multiple: Schema.optionalKey(Schema.Boolean),
        choices: Schema.Array(Schema.Struct({ label: Schema.String })),
        input: Schema.optionalKey(
          Schema.Struct({ label: Schema.String, placeholder: Schema.String }),
        ),
      }),
    ),
  }),
)
const chatWidgetOutput = Schema.Struct({ widget: Schema.String, rendered: Schema.Boolean })
const chatWidgetArguments = Schema.fromJsonString(Schema.Struct({ widget: Schema.String }))
const managedUserParts = Schema.Array(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("text"), content: Schema.String }),
    Schema.Struct({
      type: Schema.Literals(["image", "document", "audio", "video"]),
      source: Schema.Struct({
        type: Schema.Literal("data"),
        value: Schema.String,
        mimeType: Schema.optionalKey(Schema.String),
      }),
      metadata: Schema.optionalKey(Schema.JsonObject),
    }),
  ]),
).check(Schema.isMinLength(1))

const chatAdmissionOperation = {
  name: "ChatAdmission/v1",
  parameters: Schema.Struct({
    id: ApiUuidSchema,
    parts: managedUserParts,
    tools: Schema.Array(Schema.JsonObject),
    clientId: ApiUuidSchema,
    agentId: Schema.optionalKey(Schema.String),
  }),
  success: ChatSubmissionReceiptSchema,
  error: Schema.Never,
}

function storedResponseSchema(value: typeof Schema.Json.Type) {
  return Effect.try({
    try: () =>
      SchemaRepresentation.fromJsonSchemaDocument(
        JsonSchema.fromSchemaDraft2020_12(value as JsonSchema.JsonSchema),
      ).pipe(Schema.toType),
    catch: () => new ChatThreadInvalid(),
  })
}

export const prepareManagedChat = Effect.fn("prepareManagedChat")(function* (input: {
  readonly scope: ChatThreadScope
  readonly params: ChatParams
  readonly idempotencyKey?: string | undefined
}) {
  const threads = yield* ChatThreads
  const agents = yield* Agents
  const { params, scope } = input
  const id = yield* Schema.decodeUnknownEffect(ApiUuidSchema)(params.threadId).pipe(
    Effect.mapError(() => new ChatThreadInvalid()),
  )
  const options = yield* Schema.decodeUnknownEffect(managedChatOptions)(params.forwardedProps).pipe(
    Effect.mapError(() => new ChatThreadInvalid()),
  )
  if (
    params.forwardedProps.systemPrompt !== undefined &&
    params.forwardedProps.systemPrompt !== null
  )
    return yield* new ChatSystemPromptRefused()
  if (
    params.messages.length !== 1 ||
    params.messages[0]?.role !== "user" ||
    params.resume !== undefined
  )
    return yield* new ChatThreadInvalid()
  const message = params.messages[0]
  const sourceParts =
    "parts" in message ? message.parts : typeof message.content === "string" ? [] : message.content
  const wireParts = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject))(
    sourceParts ?? [],
  ).pipe(Effect.mapError(() => new ChatThreadInvalid()))
  for (const part of wireParts) {
    if (part.type === "text")
      yield* Schema.decodeUnknownEffect(Schema.String)(
        "content" in part ? part.content : part.text,
      ).pipe(Effect.mapError(() => new ChatThreadInvalid()))
  }
  const normalizedParts = yield* Effect.try({
    try: () =>
      normalizeToUIMessage(convertMessagesToModelMessages(params.messages)[0]!, () =>
        crypto.randomUUID(),
      ).parts.map(chatStoredJson),
    catch: () => new ChatThreadInvalid(),
  })
  const parts = yield* Schema.decodeUnknownEffect(managedUserParts)(normalizedParts).pipe(
    Effect.mapError(() => new ChatThreadInvalid()),
  )
  const tools = yield* Effect.try({
    try: () => params.tools.map(chatStoredJson),
    catch: () => new ChatThreadInvalid(),
  })
  for (const tool of tools) {
    if (tool.outputSchema !== undefined) yield* storedResponseSchema(tool.outputSchema)
  }
  const thread = yield* threads.get({ scope, id })
  let admission: ChatAdmission | undefined
  let rejected: ChatThreadError | ChatAttachmentsDisabled | undefined
  const parameters = {
    id,
    parts,
    tools,
    clientId: options.clientId,
    ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
  }
  const accept = Effect.fnUntraced(function* (
    command: typeof chatAdmissionOperation.parameters.Type,
  ) {
    // Recovery returns the authorized receipt even after write access or agent configuration changes.
    // These checks apply only to a new admission, not to a previously accepted intent.
    if (thread.role === "viewer") return yield* new ChatThreadForbidden()
    const agentId =
      thread.agentId === null ? null : `agent_${scope.organizationId}_${thread.agentId}`
    if (agentId === null) return yield* new ChatThreadNotFound()
    if (command.agentId !== undefined && command.agentId !== agentId)
      return yield* new ChatThreadInvalid()
    const agent = yield* agents
      .resolveForChat({ organizationId: scope.organizationId, agentId })
      .pipe(Effect.mapError(() => new ChatThreadNotFound()))
    const normalized = normalizeChatAttachments(params.messages, {
      sandbox: agent.sandboxProviderId !== null,
    })
    if (!agent.attachmentsEnabled && normalized.attachments.length > 0)
      return yield* new ChatAttachmentsDisabled()
    if (normalized.attachments.some((attachment) => attachment.result === "rejected"))
      return yield* new ChatThreadInvalid()
    admission = yield* threads.admit({
      scope,
      id: command.id,
      payload: {
        version: 1,
        parts: command.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        tools: command.tools,
        provenance: { clientId: command.clientId },
      },
    })
    return {
      threadId: admission.thread.id,
      acceptedMessageId: admission.inputMessage.id,
      threadVersion: admission.thread.lockVersion,
    }
  })
  const receipt =
    input.idempotencyKey === undefined
      ? yield* accept(parameters)
      : yield* withDatabaseIdempotency(
          {
            namespace: "chat",
            scope: [scope.organizationId, scope.tenantId, thread.id, scope.tenantUserId].join(":"),
            key: input.idempotencyKey,
            operation: chatAdmissionOperation,
            parameters,
          },
          (command) =>
            accept(command).pipe(
              Effect.catch((error) => {
                // Rejected admission must not retain input. The shared helper caches typed failures.
                // Restore this uncached failure after the transaction. See ../../../db/README.md#idempotent-database-writes.
                rejected = error
                return Effect.die(error)
              }),
            ),
        ).pipe(
          Effect.catchCause((cause) =>
            rejected &&
            cause.reasons.every((reason) => reason._tag === "Die" && reason.defect === rejected)
              ? Effect.fail<
                  ChatThreadError | ChatAttachmentsDisabled | Cause.Cause.Error<typeof cause>
                >(rejected)
              : Effect.failCause(cause),
          ),
        )
  return { admission, receipt, clientId: options.clientId }
})

export interface ManagedToolResultInput {
  readonly sourceMessageId: string
  readonly sourcePartId: string
  readonly responseTargetId: string
  readonly outcome: "succeeded" | "failed" | "skipped" | "unknown"
  readonly output: typeof Schema.Json.Type
}

const validateBuiltinChatResult = Effect.fnUntraced(function* (
  part: typeof Schema.JsonObject.Type,
  result: ManagedToolResultInput,
) {
  if (part.name === "ask_questionnaire" && result.outcome === "skipped") {
    yield* Schema.decodeUnknownEffect(Schema.NullOr(chatQuestionnaireSkipped))(result.output, {
      onExcessProperty: "error",
    })
    return
  }
  if (result.outcome !== "succeeded") return
  if (part.name === "render_widget") {
    const output = yield* Schema.decodeUnknownEffect(chatWidgetOutput)(result.output, {
      onExcessProperty: "error",
    })
    const input = yield* Schema.decodeUnknownEffect(chatWidgetArguments)(part.arguments)
    if (output.widget !== input.widget) return yield* new ChatThreadInvalid()
  }
  if (part.name === "ask_questionnaire") {
    const output = yield* Schema.decodeUnknownEffect(chatQuestionnaireOutput)(result.output, {
      onExcessProperty: "error",
    })
    if ("skipped" in output) return
    const input = yield* Schema.decodeUnknownEffect(chatQuestionnaireArguments)(part.arguments)
    const questions = new Map(input.items.map((item) => [item.name, item]))
    if (
      questions.size !== input.items.length ||
      output.answers.length !== questions.size ||
      new Set(output.answers.map((answer) => answer.name)).size !== questions.size
    )
      return yield* new ChatThreadInvalid()
    for (const answer of output.answers) {
      const item = questions.get(answer.name)
      if (
        !item ||
        answer.question !== item.title ||
        (item.required && answer.answers.length === 0) ||
        (!item.multiple && answer.answers.length > 1) ||
        (!item.input &&
          answer.answers.some((value) => !item.choices.some((choice) => choice.label === value)))
      )
        return yield* new ChatThreadInvalid()
    }
  }
})

export const resolveManagedChatTools = Effect.fn("resolveManagedChatTools")(function* (
  input: ThreadInput & {
    readonly clientId: string
    readonly results: readonly ManagedToolResultInput[]
  },
) {
  const threads = yield* ChatThreads
  const results: ChatToolResolution[] = []
  for (const result of input.results) {
    const source = yield* threads.getMessage({
      scope: input.scope,
      id: input.id,
      messageId: result.sourceMessageId,
    })
    const part = source.payload.parts.find(
      (entry) => entry.type === "tool-call" && entry.id === result.sourcePartId,
    )
    if (!part || typeof part.toolCallId !== "string") return yield* new ChatThreadInvalid()
    const output = yield* decodeChatJson(result.output).pipe(
      Effect.mapError(() => new ChatThreadInvalid()),
    )
    yield* validateBuiltinChatResult(part, result).pipe(
      Effect.mapError(() => new ChatThreadInvalid()),
    )
    const declaration = part.declaration
    if (
      result.outcome === "succeeded" &&
      Schema.is(Schema.JsonObject)(declaration) &&
      declaration.outputSchema !== undefined
    ) {
      const schema = yield* storedResponseSchema(declaration.outputSchema)
      yield* Schema.decodeUnknownEffect(schema)(output, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => new ChatThreadInvalid()),
      )
    }
    results.push({
      assistantMessageId: result.sourceMessageId,
      toolPartId: result.sourcePartId,
      responseTargetId: result.responseTargetId,
      payload: {
        version: 1,
        parts: [
          {
            id: crypto.randomUUID(),
            type: "tool-result",
            toolCallId: part.toolCallId,
            outcome: result.outcome,
            output,
          },
        ],
      },
    })
  }
  return yield* threads.resolveTools({ ...input, results })
})

export const managedChatRunParams = Effect.fn("managedChatRunParams")(function* (input: {
  readonly admission: ChatAdmission
  readonly params?:
    | Partial<Pick<ChatParams, "runId" | "parentRunId" | "forwardedProps">>
    | undefined
}) {
  const { admission, params } = input
  const claim = admission.claim
  if (!claim || !admission.thread.agentId) return yield* new ChatThreadInvalid()
  const tools = (admission.inputMessage.payload.tools ?? []) as ChatParams["tools"]
  return {
    threadId: claim.threadId,
    runId: params?.runId ?? crypto.randomUUID(),
    ...(params?.parentRunId === undefined ? {} : { parentRunId: params.parentRunId }),
    messages: [],
    tools,
    state: undefined,
    context: [],
    aguiContext: [],
    forwardedProps: {
      agentId: `agent_${claim.scope.organizationId}_${admission.thread.agentId}`,
      debug: params?.forwardedProps?.debug,
    },
  } satisfies ChatParams
})
