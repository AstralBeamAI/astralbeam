import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import type { ApiV1 } from "../../-lib/contract.server"

const chatRunInput = Schema.Struct({
  threadId: Schema.String,
  runId: Schema.String,
  messages: Schema.Array(Schema.Unknown),
  tools: Schema.Array(Schema.Unknown),
  context: Schema.Array(Schema.Unknown),
  forwardedProps: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Legacy mirror of forwardedProps sent by TanStack AI clients.",
  }),
  state: Schema.optionalKey(Schema.Unknown),
  parentRunId: Schema.optionalKey(Schema.String),
  resume: Schema.optionalKey(Schema.Array(Schema.Unknown)),
}).annotate({
  identifier: "ChatRunInput",
  description:
    "AG-UI RunAgentInput, validated by TanStack AI. Messages, tools, context, and resume entries follow AG-UI. forwardedProps accepts agentId and development-only debug. systemPrompt is rejected. Maximum request size: 32 MiB.",
  examples: [
    {
      threadId: "conversation-42",
      runId: "run-7",
      messages: [{ id: "message-1", role: "user", content: "Hello!" }],
      tools: [],
      context: [],
    },
  ],
})

export const chatApi = HttpApiGroup.make("chat", { topLevel: true })
  .add(
    HttpApiEndpoint.post("runChat", "/chat", {
      payload: chatRunInput,
      success: HttpApiSchema.StreamUint8Array({ contentType: "text/event-stream" }),
    })
      .annotate(OpenApi.Summary, "Run chat")
      .annotate(
        OpenApi.Description,
        "Stream an AG-UI agent run using a tenant user JWT. No admin claim required. HTTP failures before streaming use AstralBeamApiError. Once streaming starts, failures use RUN_ERROR events. Tool results continue in a subsequent request. Disconnecting cancels the run. Limited to 200 requests per minute per organization, tenant, and user.",
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
      const { ChatSandboxes } = yield* Effect.promise(
        () => import("@/lib/chat/sandbox/sandbox.server"),
      )
      const { consumeChatRateLimit, readChatRunParams, chatRunResponse } = yield* Effect.promise(
        () => import("./run.server"),
      )
      const { chatArtifactResponse } = yield* Effect.promise(() => import("./files.server"))
      const chat = yield* Chat
      const sandboxes = yield* ChatSandboxes
      const services = yield* Effect.context<
        | Effect.Services<ReturnType<typeof authenticateChatRequest>>
        | Effect.Services<ReturnType<typeof consumeChatRateLimit>>
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
            yield* consumeChatRateLimit(principal).pipe(Effect.provideContext(services))
            const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
            const params = yield* readChatRunParams(native)
            return yield* chatRunResponse(yield* chat.run({ params, principal }))
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
