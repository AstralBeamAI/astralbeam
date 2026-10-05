import { Effect, Schema } from "effect"
import { ApiUuidSchema } from "../../../../../lib/tenants/schemas.ts"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { ChatSubmissionReceiptSchema } from "./threads.server"
import { NonEmptyStringSchema } from "../../../../../lib/schemas.ts"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import type { ApiV1 } from "../../-lib/contract.server"

const chatRunInput = Schema.Struct({
  threadId: ApiUuidSchema,
  runId: Schema.String,
  messages: Schema.Array(Schema.Unknown),
  tools: Schema.Array(Schema.Unknown),
  context: Schema.Array(Schema.Unknown),
  forwardedProps: Schema.StructWithRest(Schema.Struct({ clientId: ApiUuidSchema }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Legacy mirror of forwardedProps sent by TanStack AI clients.",
  }),
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

export const chatApi = HttpApiGroup.make("chat", { topLevel: true })
  .add(
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
  )
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })
  .add(
    HttpApiEndpoint.get("getChatFile", "/chat/files", {
      query: Schema.Struct({ ticket: Schema.String }),
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
        "Content-Disposition": Schema.String,
        "Content-Length": Schema.String,
      }),
    })
      .annotate(OpenApi.Summary, "Download a chat artifact")
      .annotate(
        OpenApi.Description,
        "Use the signed ticket returned when chat publishes an artifact. No bearer token is required. Returns the original bytes with a content-sniffed Content-Type and Content-Disposition filename. Invalid or expired tickets, a missing sandbox, and rejected artifact checks return 404. Provider or file-read failures return 500.",
      )
      .annotate(OpenApi.Override, { security: [{ ArtifactTicket: [] }] }),
  )

export function chatHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "chat",
    Effect.fn("chatHandlers")(function* (handlers) {
      const { authenticateChatRequest } = yield* Effect.promise(
        () => import("@/lib/chat/auth.server"),
      )
      const { Chat } = yield* Effect.promise(() => import("@/lib/chat/chat.server"))
      const { ChatThreads } = yield* Effect.promise(
        () => import("@/lib/chat/threads/threads.server"),
      )
      const { prepareManagedChat } = yield* Effect.promise(
        () => import("@/lib/chat/threads/commands.server"),
      )
      const { ChatSandboxes } = yield* Effect.promise(
        () => import("@/lib/chat/sandbox/sandbox.server"),
      )
      const { consumeChatRateLimit, readChatRunParams, chatAdmissionResponse } =
        yield* Effect.promise(() => import("./run.server"))
      const { chatArtifactResponse } = yield* Effect.promise(() => import("./files.server"))
      const chat = yield* Chat
      const threads = yield* ChatThreads
      const sandboxes = yield* ChatSandboxes
      const services = yield* Effect.context<
        | Effect.Services<ReturnType<typeof authenticateChatRequest>>
        | Effect.Services<ReturnType<typeof consumeChatRateLimit>>
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
          "runChat",
          Effect.fn("runChat")(function* ({ request }) {
            const principal = yield* authenticate(request)
            const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
            const params = yield* readChatRunParams(native)
            yield* consumeChatRateLimit(principal, "message").pipe(Effect.provideContext(services))
            const scope = yield* threads.resolveScope({ principal })
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
          "getChatFile",
          Effect.fn("getChatFile")(function* ({ query }) {
            return chatArtifactResponse(yield* sandboxes.readArtifact(query.ticket))
          }),
        )
    }),
  )
}
