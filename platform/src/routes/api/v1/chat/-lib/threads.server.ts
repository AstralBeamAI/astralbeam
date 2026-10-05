import { Effect, Schema, SchemaGetter } from "effect"
import { HttpServerRequest } from "effect/http"
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"

import { LockVersionSchema, NonEmptyStringSchema } from "../../../../../lib/schemas.ts"
import { ApiUuidSchema, tenantUserEmail } from "../../../../../lib/tenants/schemas.ts"
import type { ApiV1 } from "../../-lib/contract.server"
import { restPageFields, restPageHeaders, restPageQuery } from "../../-lib/shared.server"
import type {
  ThreadRecord,
  MessageRecord,
  ParticipantRecord,
} from "../../../../../lib/chat/threads/threads.server"
import { ChatRunInputInvalid } from "./errors"
import { ChatSubmissionReceiptSchema as StoredChatSubmissionReceiptSchema } from "../../../../../lib/chat/threads/schemas.ts"

const threadRole = Schema.Literals(["viewer", "member", "manager"])
const toolExecutionLocation = Schema.Literals(["server_api", "sandbox", "browser"])
const threadDate = Schema.DateFromString.pipe(Schema.annotateEncoded({ format: "date-time" }))
const threadTitle = NonEmptyStringSchema.check(Schema.isMaxLength(200))
const threadParams = { id: ApiUuidSchema }
const participantParams = { ...threadParams, tenantUserId: ApiUuidSchema }
const threadPageQuery = Schema.Struct({
  page_size: restPageQuery.fields.page_size,
  page_after: restPageQuery.fields.page_after,
  page_before: restPageQuery.fields.page_before,
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
)
const threadSearchQuery = Schema.Struct({
  ...threadPageQuery.fields,
  q: restPageQuery.fields.q,
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
)
const threadVersionQuery = Schema.Struct({
  expected_version: Schema.String.check(Schema.isPattern(/^\d+$/)).pipe(
    Schema.decodeTo(LockVersionSchema, {
      decode: SchemaGetter.transform(Number),
      encode: SchemaGetter.transform<string, number>(String),
    }),
  ),
})

const ChatThreadRecordSchema = Schema.Struct({
  id: ApiUuidSchema,
  title: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  lockVersion: LockVersionSchema,
  currentLeafMessageId: Schema.NullOr(ApiUuidSchema),
  role: threadRole,
  writerActive: Schema.Boolean,
  createdAt: threadDate,
  updatedAt: threadDate,
}).pipe(
  Schema.annotate({ identifier: "ChatThread" }),
  Schema.encodeKeys({
    agentId: "agent_id",
    lockVersion: "version",
    currentLeafMessageId: "current_leaf_message_id",
    writerActive: "writer_active",
    createdAt: "created_at",
    updatedAt: "updated_at",
  }),
)

const chatParticipantRecord = Schema.Struct({
  tenantUserId: ApiUuidSchema,
  role: threadRole,
  name: Schema.NullOr(Schema.String),
  externalId: Schema.String,
  email: Schema.NullOr(Schema.String),
}).pipe(
  Schema.annotate({ identifier: "ChatParticipant" }),
  Schema.encodeKeys({ tenantUserId: "tenant_user_id", externalId: "external_id" }),
)

const chatTenantUserRecord = Schema.Struct({
  id: ApiUuidSchema,
  name: Schema.NullOr(Schema.String),
  externalId: Schema.String,
  email: Schema.NullOr(Schema.String),
}).pipe(
  Schema.annotate({ identifier: "ChatTenantUser" }),
  Schema.encodeKeys({ externalId: "external_id" }),
)

const chatMessageRecord = Schema.Struct({
  id: ApiUuidSchema,
  role: Schema.Literals(["user", "assistant", "tool"]),
  state: Schema.Literals(["draft", "complete", "interrupted"]),
  parentMessageId: Schema.NullOr(ApiUuidSchema),
  parts: Schema.Array(Schema.JsonObject),
  authorTenantUserId: Schema.NullOr(ApiUuidSchema),
  sourceAssistantMessageId: Schema.NullOr(ApiUuidSchema),
  sourceToolPartId: Schema.NullOr(Schema.String),
  responseTargetId: Schema.NullOr(Schema.String),
  createdAt: threadDate,
}).pipe(
  Schema.annotate({ identifier: "ChatMessage" }),
  Schema.encodeKeys({
    parentMessageId: "parent_message_id",
    authorTenantUserId: "author_tenant_user_id",
    sourceAssistantMessageId: "source_assistant_message_id",
    sourceToolPartId: "source_tool_part_id",
    responseTargetId: "response_target_id",
    createdAt: "created_at",
  }),
)

const chatPendingInteraction = Schema.Struct({
  sourceMessageId: ApiUuidSchema,
  sourcePartId: Schema.String,
  responseTargetId: Schema.String,
  toolCallId: Schema.String,
  targetTenantUserId: Schema.NullOr(ApiUuidSchema),
  targetClientId: Schema.NullOr(ApiUuidSchema),
  executionLocation: toolExecutionLocation,
}).pipe(
  Schema.annotate({ identifier: "ChatPendingInteraction" }),
  Schema.encodeKeys({
    sourceMessageId: "source_message_id",
    sourcePartId: "source_part_id",
    responseTargetId: "response_target_id",
    toolCallId: "tool_call_id",
    targetTenantUserId: "target_tenant_user_id",
    targetClientId: "target_client_id",
    executionLocation: "execution_location",
  }),
)

export const ChatSubmissionReceiptSchema = StoredChatSubmissionReceiptSchema.pipe(
  Schema.annotate({ identifier: "ChatSubmissionReceipt" }),
  Schema.encodeKeys({
    threadId: "thread_id",
    acceptedMessageId: "accepted_message_id",
    threadVersion: "thread_version",
  }),
)

const chatHistoryPage = Schema.Struct({
  messages: Schema.Array(chatMessageRecord),
  thread: ChatThreadRecordSchema,
  pendingInteractions: Schema.Array(chatPendingInteraction),
  ...restPageFields,
}).pipe(
  Schema.annotate({ identifier: "ChatHistoryPage" }),
  Schema.encodeKeys({ pendingInteractions: "pending_interactions" }),
)

const createThreadInput = Schema.Struct({
  title: Schema.optionalKey(threadTitle),
  agentId: Schema.optionalKey(Schema.String),
}).pipe(
  Schema.annotate({ identifier: "CreateChatThreadInput" }),
  Schema.encodeKeys({ agentId: "agent_id" }),
)
const updateThreadInput = Schema.Struct({
  title: threadTitle,
  lockVersion: LockVersionSchema,
}).pipe(
  Schema.annotate({ identifier: "UpdateChatThreadInput" }),
  Schema.encodeKeys({ lockVersion: "expected_version" }),
)
const setParticipantInput = Schema.Struct({
  role: threadRole,
  lockVersion: LockVersionSchema,
}).pipe(
  Schema.annotate({ identifier: "SetChatParticipantInput" }),
  Schema.encodeKeys({ lockVersion: "expected_version" }),
)
const chatToolResultInput = Schema.Struct({
  sourceMessageId: ApiUuidSchema,
  sourcePartId: NonEmptyStringSchema,
  responseTargetId: ApiUuidSchema,
  outcome: Schema.Literals(["succeeded", "failed", "skipped", "unknown"]),
  output: Schema.Json,
}).pipe(
  Schema.annotate({ identifier: "ChatToolResultInput" }),
  Schema.encodeKeys({
    sourceMessageId: "source_message_id",
    sourcePartId: "source_part_id",
    responseTargetId: "response_target_id",
  }),
)
const resolveToolInput = Schema.Struct({
  results: Schema.Array(chatToolResultInput).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  clientId: ApiUuidSchema,
  runId: Schema.optionalKey(NonEmptyStringSchema.check(Schema.isMaxLength(200))),
  parentRunId: Schema.optionalKey(NonEmptyStringSchema.check(Schema.isMaxLength(200))),
}).pipe(
  Schema.annotate({ identifier: "ResolveChatToolResultInput" }),
  Schema.encodeKeys({
    clientId: "client_id",
    runId: "run_id",
    parentRunId: "parent_run_id",
  }),
)

export const chatThreadApi = HttpApiGroup.make("chatThreads", { topLevel: true })
  .add(
    HttpApiEndpoint.post("createChatThread", "/chat/threads", {
      payload: createThreadInput,
      success: HttpApiSchema.WithHeaders(ChatThreadRecordSchema, {
        Location: Schema.String,
      }).pipe(HttpApiSchema.status(201)),
    }).annotate(OpenApi.Summary, "Create a saved conversation"),
    HttpApiEndpoint.get("listChatThreads", "/chat/threads", {
      query: threadSearchQuery,
      success: HttpApiSchema.WithHeaders(
        Schema.Struct({
          items: Schema.Array(ChatThreadRecordSchema),
          ...restPageFields,
        }).annotate({ identifier: "ChatThreadPage" }),
        restPageHeaders,
      ),
    }).annotate(OpenApi.Summary, "List your conversations"),
    HttpApiEndpoint.get("getChatThread", "/chat/threads/:id", {
      params: threadParams,
      success: ChatThreadRecordSchema,
    }).annotate(OpenApi.Summary, "Get a saved conversation"),
    HttpApiEndpoint.patch("updateChatThread", "/chat/threads/:id", {
      params: threadParams,
      payload: updateThreadInput,
      success: ChatThreadRecordSchema,
    }).annotate(OpenApi.Summary, "Rename a conversation"),
    HttpApiEndpoint.delete("deleteChatThread", "/chat/threads/:id", {
      params: threadParams,
      query: threadVersionQuery,
      success: HttpApiSchema.NoContent,
    }).annotate(OpenApi.Summary, "Delete a conversation"),
    HttpApiEndpoint.get("listChatMessages", "/chat/threads/:id/messages", {
      params: threadParams,
      query: threadPageQuery,
      success: HttpApiSchema.WithHeaders(chatHistoryPage, restPageHeaders),
    }).annotate(OpenApi.Summary, "Read conversation history"),
    HttpApiEndpoint.get("listChatParticipants", "/chat/threads/:id/participants", {
      params: threadParams,
      query: threadPageQuery,
      success: HttpApiSchema.WithHeaders(
        Schema.Struct({
          items: Schema.Array(chatParticipantRecord),
          ...restPageFields,
        }).annotate({ identifier: "ChatParticipantPage" }),
        restPageHeaders,
      ),
    }).annotate(OpenApi.Summary, "List conversation participants"),
    HttpApiEndpoint.get("searchChatTenantUsers", "/chat/threads/:id/tenant-users", {
      params: threadParams,
      query: threadSearchQuery,
      success: HttpApiSchema.WithHeaders(
        Schema.Struct({
          items: Schema.Array(chatTenantUserRecord),
          ...restPageFields,
        }).annotate({ identifier: "ChatTenantUserPage" }),
        restPageHeaders,
      ),
    })
      .annotate(OpenApi.Summary, "Search same-Tenant users for sharing")
      .annotate(
        OpenApi.Description,
        "Requires a conversation manager. Searches names and external IDs within the conversation's Tenant. Returns only identity and display fields, without user metadata or administrative flags.",
      ),
    HttpApiEndpoint.put("setChatParticipant", "/chat/threads/:id/participants/:tenantUserId", {
      params: participantParams,
      payload: setParticipantInput,
      success: chatParticipantRecord,
    }).annotate(OpenApi.Summary, "Add a participant or change their role"),
    HttpApiEndpoint.delete(
      "removeChatParticipant",
      "/chat/threads/:id/participants/:tenantUserId",
      {
        params: participantParams,
        query: threadVersionQuery,
        success: HttpApiSchema.NoContent,
      },
    ).annotate(OpenApi.Summary, "Remove a conversation participant"),
    HttpApiEndpoint.post("resolveChatToolResult", "/chat/threads/:id/tool-results", {
      params: threadParams,
      payload: resolveToolInput,
      success: Schema.Union([
        HttpApiSchema.StreamUint8Array({ contentType: "text/event-stream" }),
        ChatSubmissionReceiptSchema,
      ]),
    }).annotate(OpenApi.Summary, "Submit a pending tool result"),
    HttpApiEndpoint.get(
      "getChatAttachment",
      "/chat/threads/:id/messages/:messageId/attachments/:partId",
      {
        params: { ...threadParams, messageId: ApiUuidSchema, partId: NonEmptyStringSchema },
        success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
          "Content-Disposition": Schema.String,
          "Content-Length": Schema.String,
        }),
      },
    ).annotate(OpenApi.Summary, "Download a saved attachment"),
  )
  .annotate(HttpApi.ParseOptions, { onExcessProperty: "error" })
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })
  .annotate(
    OpenApi.Description,
    "Saved conversations require a tenant user JWT and an identity synchronized through POST /me. Viewers read history, members also send messages and resolve tools, and managers additionally rename, delete, and manage participants. Sharing is limited to the same Tenant. Unknown and inaccessible conversations both return 404. New messages append to the current history path automatically. Metadata and participant changes require the current conversation version. Deleting a conversation stops subsequent writes.",
  )

function threadResource(row: ThreadRecord) {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agentId === null ? null : `agent_${row.organizationId}_${row.agentId}`,
    lockVersion: row.lockVersion,
    currentLeafMessageId: row.currentLeafMessageId,
    role: row.role,
    writerActive: row.writerActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function chatParticipantResource(row: ParticipantRecord) {
  return {
    tenantUserId: row.tenantUserId,
    role: row.role,
    name: row.name,
    externalId: row.externalId,
    email: row.email,
  }
}

function messageResource(row: MessageRecord) {
  return {
    id: row.id,
    role: row.role,
    state: row.state,
    parentMessageId: row.parentMessageId,
    parts: row.payload.parts.map((part) => {
      const source = part.source
      if (
        (part.type === "image" || part.type === "document") &&
        Schema.is(Schema.JsonObject)(source) &&
        source.type === "data"
      ) {
        return {
          ...part,
          source: {
            type: "attachment",
            ...(typeof source.mimeType === "string" ? { mimeType: source.mimeType } : {}),
          },
        }
      }
      return part
    }),
    authorTenantUserId: row.authorTenantUserId,
    sourceAssistantMessageId: row.sourceAssistantMessageId,
    sourceToolPartId: row.sourceToolPartId,
    responseTargetId: row.responseTargetId,
    createdAt: row.createdAt,
  }
}

export function chatThreadHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "chatThreads",
    Effect.fn("chatThreadHandlers")(function* (handlers) {
      const { authenticateChatRequest } = yield* Effect.promise(
        () => import("@/lib/chat/auth.server"),
      )
      const { ChatThreads } = yield* Effect.promise(
        () => import("@/lib/chat/threads/threads.server"),
      )
      const { resolveManagedChatTools } = yield* Effect.promise(
        () => import("@/lib/chat/threads/commands.server"),
      )
      const { ChatThreadNotFound, ChatThreadForbidden } = yield* Effect.promise(
        () => import("@/lib/chat/threads/errors"),
      )
      const { TenantUsers } = yield* Effect.promise(
        () => import("@/lib/tenants/tenant-users.server"),
      )
      const { consumeRestRateLimit } = yield* Effect.promise(() => import("../../-lib/auth.server"))
      const { restPage, restPageOptions } = yield* Effect.promise(
        () => import("../../-lib/pagination.server"),
      )
      const { chatAdmissionResponse, consumeChatRateLimit, readChatRequestBody } =
        yield* Effect.promise(() => import("./run.server"))
      const { chatArtifactResponse } = yield* Effect.promise(() => import("./files.server"))
      const { HttpServerResponse } = yield* Effect.promise(() => import("effect/http"))
      const threads = yield* ChatThreads
      const tenantUsers = yield* TenantUsers
      const services = yield* Effect.context<
        | Effect.Services<ReturnType<typeof authenticateChatRequest>>
        | Effect.Services<ReturnType<typeof consumeChatRateLimit>>
        | Effect.Services<ReturnType<typeof chatAdmissionResponse>>
      >()
      const authenticate = (request: HttpServerRequest.HttpServerRequest) =>
        HttpServerRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap(authenticateChatRequest),
          Effect.provideContext(services),
        )
      const scopeFor = (request: HttpServerRequest.HttpServerRequest) =>
        authenticate(request).pipe(
          Effect.flatMap((principal) => threads.resolveScope({ principal })),
        )
      return handlers
        .handleRaw(
          "resolveChatToolResult",
          Effect.fn("resolveChatToolResult")(function* ({ request, params }) {
            const principal = yield* authenticate(request)
            const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
            const body = yield* readChatRequestBody(native)
            const payload = yield* Schema.decodeUnknownEffect(resolveToolInput)(body, {
              onExcessProperty: "error",
            }).pipe(Effect.mapError(() => new ChatRunInputInvalid()))
            yield* consumeChatRateLimit(principal, "tool-result").pipe(
              Effect.provideContext(services),
            )
            const scope = yield* threads.resolveScope({ principal })
            const admission = yield* resolveManagedChatTools({
              scope,
              id: params.id,
              clientId: payload.clientId,
              results: payload.results,
            }).pipe(Effect.provideService(ChatThreads, threads))
            if (!admission.claim)
              return HttpServerResponse.jsonUnsafe(
                Schema.encodeSync(ChatSubmissionReceiptSchema)({
                  threadId: admission.thread.id,
                  acceptedMessageId: admission.inputMessage.id,
                  threadVersion: admission.thread.lockVersion,
                }),
              )
            return yield* chatAdmissionResponse({
              admission,
              params: payload,
              principal,
              clientId: payload.clientId,
            }).pipe(Effect.provideContext(services))
          }),
        )
        .handleAll({
          createChatThread: Effect.fn("createChatThread")(function* ({ request, payload }) {
            const scope = yield* scopeFor(request)
            yield* consumeRestRateLimit("chat-resource", [
              scope.organizationId,
              scope.tenantId,
              scope.tenantUserId,
            ]).pipe(Effect.provideContext(services))
            const row = yield* threads.create({
              scope,
              ...payload,
            })
            return HttpApiSchema.withHeaders({
              body: threadResource(row),
              headers: { Location: `/api/v1/chat/threads/${row.id}` },
            })
          }),
          listChatThreads: Effect.fn("listChatThreads")(function* ({ request, query }) {
            const scope = yield* scopeFor(request)
            const options = yield* restPageOptions(query, "chat_threads", scope)
            const page = yield* threads.list({ scope, ...options })
            return yield* restPage(
              { ...page, items: page.items.map(threadResource) },
              { ...options, scope, collection: "chat_threads", url: request.url },
            )
          }),
          getChatThread: Effect.fn("getChatThread")(function* ({ request, params }) {
            return threadResource(
              yield* threads.get({ scope: yield* scopeFor(request), id: params.id }),
            )
          }),
          updateChatThread: Effect.fn("updateChatThread")(function* ({ request, params, payload }) {
            return threadResource(
              yield* threads.rename({
                scope: yield* scopeFor(request),
                id: params.id,
                ...payload,
              }),
            )
          }),
          deleteChatThread: Effect.fn("deleteChatThread")(function* ({ request, params, query }) {
            yield* threads.remove({
              scope: yield* scopeFor(request),
              id: params.id,
              lockVersion: query.expected_version,
            })
          }),
          listChatMessages: Effect.fn("listChatMessages")(function* ({ request, params, query }) {
            const scope = yield* scopeFor(request)
            const cursorScope = { ...scope, threadId: params.id }
            const options = yield* restPageOptions(query, "chat_messages", cursorScope)
            const input = { scope, id: params.id }
            const {
              thread,
              messages: page,
              pending,
            } = yield* threads.snapshot({ ...input, ...options })
            const response = yield* restPage(
              { ...page, items: page.items.map(messageResource) },
              { ...options, scope: cursorScope, collection: "chat_messages", url: request.url },
            )
            return HttpApiSchema.withHeaders({
              body: {
                messages: response.body.items,
                page_after: response.body.page_after,
                page_before: response.body.page_before,
                thread: threadResource(thread),
                pendingInteractions: pending.map(({ message, part, target }) => ({
                  sourceMessageId: message.id,
                  sourcePartId: Schema.decodeUnknownSync(Schema.String)(part.id),
                  responseTargetId: Schema.decodeUnknownSync(Schema.String)(target.id),
                  toolCallId: Schema.decodeUnknownSync(Schema.String)(part.toolCallId),
                  targetTenantUserId:
                    typeof target.tenantUserId === "string" ? target.tenantUserId : null,
                  targetClientId: typeof target.clientId === "string" ? target.clientId : null,
                  executionLocation: Schema.decodeUnknownSync(toolExecutionLocation)(
                    part.executionLocation,
                  ),
                })),
              },
              headers: response.headers,
            })
          }),
          listChatParticipants: Effect.fn("listChatParticipants")(function* ({
            request,
            params,
            query,
          }) {
            const scope = yield* scopeFor(request)
            const cursorScope = { ...scope, threadId: params.id }
            const options = yield* restPageOptions(query, "chat_participants", cursorScope)
            const page = yield* threads.participants({ scope, id: params.id, ...options })
            return yield* restPage(
              { ...page, items: page.items.map(chatParticipantResource) },
              {
                ...options,
                scope: cursorScope,
                collection: "chat_participants",
                url: request.url,
              },
            )
          }),
          searchChatTenantUsers: Effect.fn("searchChatTenantUsers")(function* ({
            request,
            params,
            query,
          }) {
            const scope = yield* scopeFor(request)
            const thread = yield* threads.get({ scope, id: params.id })
            if (thread.role !== "manager") return yield* new ChatThreadForbidden()
            const cursorScope = { ...scope, threadId: params.id }
            const options = yield* restPageOptions(query, "chat_tenant_users", cursorScope)
            const page = yield* tenantUsers.list({ ...options, scope, tenantId: scope.tenantId })
            return yield* restPage(
              {
                ...page,
                items: page.items.map((user) => ({
                  id: user.id,
                  name: user.name,
                  externalId: user.externalId,
                  email: tenantUserEmail(user),
                })),
              },
              { ...options, scope: cursorScope, collection: "chat_tenant_users", url: request.url },
            )
          }),
          setChatParticipant: Effect.fn("setChatParticipant")(function* ({
            request,
            params,
            payload,
          }) {
            return chatParticipantResource(
              yield* threads.setParticipant({
                scope: yield* scopeFor(request),
                ...params,
                ...payload,
              }),
            )
          }),
          removeChatParticipant: Effect.fn("removeChatParticipant")(function* ({
            request,
            params,
            query,
          }) {
            yield* threads.removeParticipant({
              scope: yield* scopeFor(request),
              ...params,
              lockVersion: query.expected_version,
            })
          }),
          getChatAttachment: Effect.fn("getChatAttachment")(function* ({ request, params }) {
            const message = yield* threads.getMessage({
              scope: yield* scopeFor(request),
              id: params.id,
              messageId: params.messageId,
            })
            const part = message.payload.parts.find((entry) => entry.id === params.partId)
            const source = part?.source
            if (
              !Schema.is(Schema.JsonObject)(source) ||
              source.type !== "data" ||
              typeof source.value !== "string"
            )
              return yield* new ChatThreadNotFound()
            const metadata = part?.metadata
            const path =
              Schema.is(Schema.JsonObject)(metadata) && typeof metadata.filename === "string"
                ? metadata.filename
                : "attachment"
            const mimeType =
              typeof source.mimeType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(source.mimeType)
                ? source.mimeType
                : "application/octet-stream"
            const bytes = yield* Effect.try({
              try: () =>
                Uint8Array.from(atob(source.value as string), (character) =>
                  character.charCodeAt(0),
                ),
              catch: () => new ChatThreadNotFound(),
            })
            return chatArtifactResponse({ bytes, mimeType, path })
          }),
        })
    }),
  )
}
