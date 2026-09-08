import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi"
import type { ApiV1 } from "../../-lib/contract.server"
import { restFault, restHandleErrors, restRateLimitFault } from "../../-lib/responses.server"

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
  examples: [{
    threadId: "conversation-42",
    runId: "run-7",
    messages: [{ id: "message-1", role: "user", content: "Hello!" }],
    tools: [],
    context: [],
  }],
})

export const chatApi = HttpApiGroup.make("chat", { topLevel: true }).add(
  HttpApiEndpoint.post("runChat", "/chat", {
    payload: chatRunInput,
    success: HttpApiSchema.StreamUint8Array({ contentType: "text/event-stream" }),
  }).annotate(OpenApi.Summary, "Run chat").annotate(
    OpenApi.Description,
    "Stream an AG-UI agent run using a tenant user JWT. No admin claim required. HTTP failures before streaming use AstralBeamApiError. Once streaming starts, failures use RUN_ERROR events. Tool results continue in a subsequent request. Disconnecting cancels the run. Limited to 20 requests per minute per organization, tenant, and user.",
  ),
  HttpApiEndpoint.get("getChatConfig", "/chat/config", {
    query: Schema.Struct({ agentId: Schema.optionalKey(Schema.String) }),
    success: Schema.Struct({ capabilities: Schema.Struct({ attachments: Schema.Boolean }) })
      .annotate({ identifier: "ChatConfiguration" }),
  }).annotate(OpenApi.Summary, "Get chat capabilities").annotate(
    OpenApi.Description,
    "Read the selected agent's attachment grant using a tenant user JWT. Omit agentId to use the organization's default agent. Client settings may narrow this grant, never widen it.",
  ),
).annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] }).add(
  HttpApiEndpoint.get("getChatFile", "/chat/files", {
    query: Schema.Struct({ ticket: Schema.String }),
    success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
      "Content-Disposition": Schema.String,
      "Content-Length": Schema.String,
    }),
  }).annotate(OpenApi.Summary, "Download a chat artifact").annotate(
    OpenApi.Description,
    "Use the signed ticket returned when chat publishes an artifact. No bearer token is required. Returns the original bytes with a content-sniffed Content-Type and Content-Disposition filename. Invalid or expired tickets, a missing sandbox, and rejected artifact checks return 404. Provider or file-read failures return 500.",
  ).annotate(OpenApi.Override, { security: [{ ArtifactTicket: [] }] }),
)

function chatAuthenticate(request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const { authenticateChatRequest, isChatAuthenticationError } = yield* Effect.promise(() =>
      import("@/lib/chat/auth.server")
    )
    const native = yield* HttpServerRequest.toWeb(request)
    return yield* Effect.tryPromise({
      try: () => authenticateChatRequest(native),
      catch: (error) =>
        isChatAuthenticationError(error)
          ? restFault(401, "The chat auth token is invalid.")
          : error,
    })
  })
}

export function chatHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(api, "chat", (handlers) =>
    handlers
      .handleRaw(
        "runChat",
        Effect.fn(function* ({ request }) {
          const principal = yield* chatAuthenticate(request)
          const { consumeChatRateLimit } = yield* Effect.promise(() =>
            import("@/lib/chat/rate-limit.server")
          )
          yield* consumeChatRateLimit(principal).pipe(Effect.mapError(restRateLimitFault))
          const { runChatRequest } = yield* Effect.promise(() => import("./run.server"))
          const native = yield* HttpServerRequest.toWeb(request)
          const response = yield* Effect.tryPromise({
            try: () => runChatRequest(native, principal),
            catch: (error) => error,
          })
          return HttpServerResponse.fromWeb(response)
        }, restHandleErrors("runChat")),
      )
      .handle(
        "getChatConfig",
        Effect.fn(function* ({ query, request }) {
          const principal = yield* chatAuthenticate(request)
          const { resolveChatAgent } = yield* Effect.promise(() =>
            import("@/lib/chat/agent.server")
          )
          const agent = yield* Effect.tryPromise({
            try: () => resolveChatAgent(query.agentId, principal.organization.id),
            catch: (error) => error,
          })
          if (!agent) return yield* Effect.fail(restFault(404, "Agent not found."))
          return { capabilities: { attachments: agent.attachmentsEnabled } }
        }, restHandleErrors("getChatConfig")),
      )
      .handle(
        "getChatFile",
        Effect.fn(function* ({ query }) {
          const { serveChatFile } = yield* Effect.promise(() => import("./files.server"))
          return HttpServerResponse.fromWeb(
            yield* Effect.tryPromise({
              try: () => serveChatFile(query.ticket),
              catch: (error) => error,
            }),
          )
        }, restHandleErrors("getChatFile")),
      ))
}
