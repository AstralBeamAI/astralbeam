import { Effect, Schema } from "effect"
import { ApiUuidSchema } from "@/lib/tenants/schemas.ts"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { ChatSubmissionReceiptSchema } from "./threads.server"
import { chatArtifactResponse, chatFileSuccess } from "./files.server"
import { NonEmptyStringSchema } from "@/lib/schemas.ts"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import type { ApiV1 } from "../../-lib/contract.server"
import { restResourceSecurity } from "../../-lib/shared.server"

const chatRunInput = Schema.Struct({
  threadId: ApiUuidSchema,
  runId: Schema.String,
  messages: Schema.Array(Schema.Unknown),
  tools: Schema.Array(Schema.Unknown),
  context: Schema.Array(Schema.Unknown),
  forwardedProps: Schema.StructWithRest(Schema.Struct({ clientId: ApiUuidSchema }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
  state: Schema.optionalKey(Schema.Unknown),
  parentRunId: Schema.optionalKey(Schema.String),
}).annotate({
  identifier: "ChatRunInput",
  description:
    "AG-UI RunAgentInput, validated by TanStack AI. Use the saved conversation UUID as threadId, send exactly one new user message and set forwardedProps.clientId. The server appends to the current history path, loads saved context, and uses the conversation's selected agent. Replacement history, resume entries, and systemPrompt are rejected. forwardedProps.debug is development-only. Maximum request size: 32 MiB.",
  examples: [
    {
      threadId: "019a0000-0000-7000-8000-000000000004",
      runId: "run-7",
      messages: [{ id: "message-1", role: "user", content: "Hello!" }],
      tools: [],
      context: [],
      forwardedProps: {
        clientId: "019a0000-0000-7000-8000-000000000003",
      },
    },
  ],
})

const chatFileInput = Schema.Struct({
  agentId: Schema.optionalKey(Schema.String),
  type: Schema.Literals(["image", "document"]),
  source: Schema.Struct({
    type: Schema.Literal("data"),
    value: Schema.String,
    mimeType: Schema.String,
  }),
  metadata: Schema.Struct({ filename: Schema.String }),
})

export const chatApi = HttpApiGroup.make("chat", { topLevel: true })
  .add(
    HttpApiEndpoint.post("uploadChatFile", "/chat/files", {
      payload: chatFileInput,
      success: Schema.Struct({
        fileId: ApiUuidSchema,
        mimeType: Schema.String,
        byteSize: Schema.Int,
      }).annotate({ identifier: "UploadedChatFile" }),
    })
      .annotate(OpenApi.Summary, "Upload a chat file")
      .annotate(
        OpenApi.Description,
        "Upload a file before sending a message using a synchronized tenant user JWT. The returned fileId is private to the uploader until sending attaches it to a message. Send it as source: { type: 'file', value: fileId }. Uploads do not expire. Maximum request size: 32 MiB.",
      ),
    HttpApiEndpoint.post("runChat", "/chat", {
      headers: Schema.Struct({
        "idempotency-key": Schema.optionalKey(
          NonEmptyStringSchema.check(Schema.isMaxCodePoints(255)),
        ),
      }),
      payload: chatRunInput,
      success: [
        HttpApiSchema.StreamUint8Array({ contentType: "text/event-stream" }),
        ChatSubmissionReceiptSchema,
      ],
    })
      .annotate(OpenApi.Summary, "Run chat")
      .annotate(
        OpenApi.Description,
        "Save one new user message and stream an AG-UI agent run for a conversation participant using a synchronized tenant user JWT. An optional Idempotency-Key retains acceptance for 24 hours. An identical retry returns an application/json admission receipt without generation. Changed input under the same key returns 400 and simultaneous use returns 409. HTTP failures before streaming use AstralBeamApiError. Once streaming starts, failures use RUN_ERROR events. Submit tool results to the conversation's tool-results endpoint. Disconnecting cancels the foreground run and preserves saved history. Limited to 20 new turns per minute per organization, tenant, and user.",
      ),
    HttpApiEndpoint.get("getChatConfig", "/chat/config", {
      query: Schema.Struct({ agentId: Schema.optionalKey(Schema.String) }),
      success: Schema.Struct({
        capabilities: Schema.Struct({ attachments: Schema.Boolean }),
      }).annotate({ identifier: "ChatConfiguration" }),
    })
      .annotate(OpenApi.Summary, "Get chat capabilities")
      .annotate(
        OpenApi.Description,
        "Read the selected agent's attachment grant using a tenant user JWT. Omit agentId to use the organization's default agent. Client settings may narrow this grant, never widen it.",
      ),
    HttpApiEndpoint.get("getChatUsage", "/chat/usage", {
      query: Schema.Struct({ threadId: Schema.optionalKey(ApiUuidSchema) }),
      success: Schema.Struct({
        usageLimits: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            scope: Schema.Literals(["global", "tenant", "tenant_user", "thread"]),
            metric: Schema.Literals(["tokens", "spend"]),
            amount: Schema.String,
            used: Schema.String,
            resetsAt: Schema.NullOr(Schema.String),
          }),
        ),
      }).annotate({ identifier: "ChatUsage" }),
    })
      .annotate(OpenApi.Summary, "Get usage limits")
      .annotate(
        OpenApi.Description,
        "Read the usage limits that apply to the current tenant user and how much of each is used, using a tenant user JWT. Amounts and usage are decimal strings, in tokens or US dollars. resetsAt is null until usage opens a window. Pass the threadId of a conversation you participate in to include per-conversation limits.",
      ),
  )
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })
  .add(
    HttpApiEndpoint.get("getThreadAttachment", "/chat/files", {
      query: Schema.Struct({
        threadId: Schema.optionalKey(ApiUuidSchema),
        tenantId: Schema.optionalKey(ApiUuidSchema),
        fileId: ApiUuidSchema,
        filename: Schema.optionalKey(Schema.String),
      }),
      success: chatFileSuccess,
    })
      .annotate(OpenApi.Override, restResourceSecurity)
      .annotate(OpenApi.Summary, "Download a chat file")
      .annotate(
        OpenApi.Description,
        "Pass the fileId from a saved message, its threadId, and an optional download filename. Tenant JWTs require current conversation membership. Administrative reads also pass tenantId and require directory-read permission through an Organization API key, Organization-management JWT, or signed Tenant admin JWT. Send X-File-Preview: true for a cached thumbnail, or 204 when unavailable. Only the uploader's unsent previews may omit threadId. Original downloads verify stored bytes and remain no-store. Configured reverse proxies can stream previews with private browser caching and ETag revalidation after authorization.",
      ),
  )

export function chatHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "chat",
    Effect.fnUntraced(function* (handlers) {
      const { authenticateChatRequest } = yield* Effect.promise(() => import("@/lib/chat/auth"))
      const { Chat } = yield* Effect.promise(() => import("@/lib/chat/chat"))
      const { ChatThreads } = yield* Effect.promise(() => import("@/lib/chat/threads/threads"))
      const { prepareManagedChat } = yield* Effect.promise(
        () => import("@/lib/chat/threads/commands"),
      )
      const {
        checkChatUsageLimits,
        consumeChatRateLimit,
        readChatRunParams,
        chatAdmissionResponse,
        readChatRequestBody,
      } = yield* Effect.promise(() => import("./run.server"))
      const { ChatFiles } = yield* Effect.promise(
        () => import("@/lib/chat/attachments/attachments"),
      )
      const { ChatAttachmentsDisabled } = yield* Effect.promise(() => import("@/lib/chat/errors"))
      const { Config } = yield* Effect.promise(() => import("@/lib/config/config"))
      const config = yield* Config
      const { ChatThreadInvalid, ChatThreadNotFound, ChatFileUnavailable } = yield* Effect.promise(
        () => import("@/lib/chat/threads/errors"),
      )
      const { authenticateRestRequest, consumeRestRateLimit } = yield* Effect.promise(
        () => import("../../-lib/auth.server"),
      )
      const { UsageLimits } = yield* Effect.promise(
        () => import("@/lib/usage-limits/usage-limits.server"),
      )
      const usageLimits = yield* UsageLimits
      const files = yield* ChatFiles
      const chat = yield* Chat
      const threads = yield* ChatThreads
      const services = yield* Effect.context<
        | Effect.Services<ReturnType<typeof authenticateChatRequest>>
        | Effect.Services<ReturnType<typeof authenticateRestRequest>>
        | Effect.Services<ReturnType<typeof consumeChatRateLimit>>
        | Effect.Services<ReturnType<typeof checkChatUsageLimits>>
        | Effect.Services<ReturnType<typeof prepareManagedChat>>
        | Effect.Services<ReturnType<typeof chatAdmissionResponse>>
      >()
      const authenticate = (request: HttpServerRequest.HttpServerRequest) =>
        HttpServerRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap(authenticateChatRequest),
          Effect.provideContext(services),
        )
      return handlers
        .handleRaw(
          "uploadChatFile",
          Effect.fn("uploadChatFile")(function* ({ request }) {
            const principal = yield* authenticate(request)
            yield* consumeChatRateLimit(principal, "upload").pipe(Effect.provideContext(services))
            const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
            const body = yield* readChatRequestBody(native)
            const input = yield* Schema.decodeUnknownEffect(chatFileInput)(body).pipe(
              Effect.mapError(() => new ChatThreadInvalid()),
            )
            if (!(yield* chat.capabilities({ principal, agentId: input.agentId })).attachments)
              return yield* new ChatAttachmentsDisabled()
            const scope = yield* threads.resolveScope({ principal })
            const payload = yield* files.store({
              scope,
              payload: {
                version: 1,
                parts: [
                  {
                    id: crypto.randomUUID(),
                    type: input.type,
                    source: input.source,
                    metadata: input.metadata,
                  },
                ],
              },
            })
            const source = payload.parts[0]!.source as {
              id: string
              mimeType: string
              byteSize: number
            }
            return HttpServerResponse.jsonUnsafe({
              fileId: source.id,
              mimeType: source.mimeType,
              byteSize: source.byteSize,
            })
          }),
        )
        .handleRaw(
          "runChat",
          Effect.fn("runChat")(function* ({ request }) {
            const principal = yield* authenticate(request)
            yield* consumeChatRateLimit(principal, "message").pipe(Effect.provideContext(services))
            const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
            const params = yield* readChatRunParams(native)
            const scope = yield* threads.resolveScope({ principal })
            yield* checkChatUsageLimits({ principal, scope, threadId: params.threadId }).pipe(
              Effect.provideContext(services),
            )
            const { admission, receipt, clientId } = yield* prepareManagedChat({
              scope,
              params,
              idempotencyKey: native.headers.get("Idempotency-Key") ?? undefined,
            }).pipe(Effect.provideContext(services))
            if (!admission)
              return HttpServerResponse.jsonUnsafe(
                Schema.encodeSync(ChatSubmissionReceiptSchema)(receipt),
              )
            return yield* chatAdmissionResponse({ admission, params, principal, clientId }).pipe(
              Effect.provideContext(services),
            )
          }),
        )
        .handle(
          "getChatConfig",
          Effect.fn("getChatConfig")(function* ({ query, request }) {
            const principal = yield* authenticate(request)
            return { capabilities: yield* chat.capabilities({ principal, agentId: query.agentId }) }
          }),
        )
        .handle(
          "getChatUsage",
          Effect.fn("getChatUsage")(function* ({ query, request }) {
            const principal = yield* authenticate(request)
            const scope = yield* threads.resolveScope({ principal })
            // Per-conversation usage is visible only to the conversation's participants.
            if (query.threadId) yield* threads.get({ scope, id: query.threadId })
            const limits = yield* usageLimits.applicable({
              organizationId: principal.organization.id,
              listedIds: principal.usageLimitIds ?? [],
            })
            const statuses = yield* usageLimits.status({
              limits,
              subject: { ...scope, threadId: query.threadId },
            })
            return {
              usageLimits: statuses.map(({ limit, used, resetsAt }) => ({
                id: limit.id,
                name: limit.name,
                scope: limit.scope,
                metric: limit.metric,
                amount: limit.amount,
                used,
                resetsAt: resetsAt?.toISOString() ?? null,
              })),
            }
          }),
        )
        .handle(
          "getThreadAttachment",
          Effect.fn("getThreadAttachment")(function* ({ query, request }) {
            const preview = request.headers["x-file-preview"] === "true"
            let scope: Parameters<typeof files.read>[0]["scope"]
            if (query.tenantId) {
              const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
              const access = yield* authenticateRestRequest(native).pipe(
                Effect.provideContext(services),
              )
              if (!query.threadId) return yield* new ChatThreadInvalid()
              yield* threads.directoryGet({
                scope: access,
                tenantId: query.tenantId,
                id: query.threadId,
              })
              scope = {
                organizationId: access.organizationId,
                tenantId: query.tenantId,
                threadId: query.threadId,
              }
            } else {
              const principal = yield* authenticate(request)
              const access = yield* threads.resolveScope({ principal })
              yield* consumeRestRateLimit("chat-resource", [
                access.organizationId,
                access.tenantId,
                access.tenantUserId,
              ]).pipe(Effect.provideContext(services))
              if (query.threadId) yield* threads.get({ scope: access, id: query.threadId })
              else if (!preview) return yield* new ChatThreadInvalid()
              scope = {
                organizationId: access.organizationId,
                tenantId: access.tenantId,
                ...(query.threadId ? { threadId: query.threadId } : {}),
                ...(preview ? { tenantUserId: access.tenantUserId } : {}),
              }
            }
            const proxyPreview = preview && (yield* config.get("asset_delivery")) === "proxy"
            if (proxyPreview && request.headers["x-asset-proxy"] !== "1")
              return yield* new ChatFileUnavailable()
            const file = yield* Effect.gen(function* () {
              if (proxyPreview)
                return { url: yield* files.previewUrl({ scope, fileId: query.fileId }) }
              return yield* files.read({
                scope,
                fileId: query.fileId,
                ...(preview ? { preview: true } : {}),
              })
            }).pipe(
              Effect.catchTag("ChatThreadInvalid", () => Effect.fail(new ChatThreadNotFound())),
            )
            return yield* chatArtifactResponse({
              ...file,
              path: preview ? "preview.webp" : (query.filename ?? "artifact"),
              preview,
            })
          }),
        )
    }),
  )
}
