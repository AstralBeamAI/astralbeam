import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import { ApiUuidSchema } from "@/lib/schemas"
import { UploadInputSchema, UploadStatusSchema } from "@/lib/chat/attachments/upload-schemas"
import type { ApiV1 } from "../../-lib/contract.server"

const uploadParams = Schema.Struct({ id: ApiUuidSchema })
export const uploadApi = HttpApiGroup.make("uploads", { topLevel: true })
  .add(
    HttpApiEndpoint.post("prepareChatUpload", "/chat/uploads", {
      payload: UploadInputSchema,
      success: UploadStatusSchema,
    })
      .annotate(OpenApi.Summary, "Prepare a private file upload")
      .annotate(
        OpenApi.Description,
        "Provide prepare_key to recover the same uploader-private session after a lost response. Retries must keep the filename, content type, size, and SHA-256 unchanged. A preparing session may be polled or cancelled. Use a new key for a new upload after cancellation or expiry.",
      ),
    HttpApiEndpoint.get("getChatUpload", "/chat/uploads/:id", {
      params: uploadParams,
      success: UploadStatusSchema,
    }).annotate(OpenApi.Summary, "Read upload progress"),
    HttpApiEndpoint.delete("cancelPreparedChatUpload", "/chat/uploads", {
      query: Schema.Struct({ prepare_key: ApiUuidSchema }),
      success: HttpApiSchema.NoContent,
    })
      .annotate(OpenApi.Summary, "Cancel an upload by its preparation key")
      .annotate(
        OpenApi.Description,
        "Cancel the current uploader's session for prepare_key after a lost preparation response. A missing key is an idempotent success. Files claimed by a conversation return 409 with problem type urn:file-upload:claimed. Other conflicts remain retryable.",
      ),
    HttpApiEndpoint.post("signChatUploadParts", "/chat/uploads/:id/parts", {
      params: uploadParams,
      payload: Schema.Struct({
        parts: Schema.Array(Schema.Int).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
      }),
      success: Schema.Struct({
        parts: Schema.Array(Schema.Struct({ number: Schema.Int, url: Schema.String })),
      }),
    }).annotate(OpenApi.Summary, "Sign staging part uploads"),
    HttpApiEndpoint.post("completeChatUpload", "/chat/uploads/:id/complete", {
      params: uploadParams,
      success: UploadStatusSchema,
    }).annotate(OpenApi.Summary, "Verify and complete an upload"),
    HttpApiEndpoint.delete("cancelChatUpload", "/chat/uploads/:id", {
      params: uploadParams,
      success: HttpApiSchema.NoContent,
    })
      .annotate(OpenApi.Summary, "Cancel an unclaimed upload")
      .annotate(
        OpenApi.Description,
        "Files claimed by a conversation return 409 with problem type urn:file-upload:claimed. Other conflicts remain retryable.",
      ),
  )
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })

export function uploadHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "uploads",
    Effect.fn("uploadHandlers")(function* (handlers) {
      const { authenticateChatRequest } = yield* Effect.promise(() => import("@/lib/chat/auth"))
      const { consumeRestRateLimit } = yield* Effect.promise(() => import("../../-lib/auth.server"))
      const { Agents } = yield* Effect.promise(() => import("@/lib/agents/agents.server"))
      const { ChatThreads } = yield* Effect.promise(() => import("@/lib/chat/threads/threads"))
      const { Uploads } = yield* Effect.promise(
        () => import("@/lib/chat/attachments/uploads.server"),
      )
      const { UploadConflict } = yield* Effect.promise(
        () => import("@/lib/chat/attachments/errors"),
      )
      const { ChatAttachmentsDisabled } = yield* Effect.promise(() => import("@/lib/chat/errors"))
      const { provideClusterWorkflowEngine } = yield* Effect.promise(
        () => import("@/lib/cluster/runtime"),
      )
      const { Config } = yield* Effect.promise(() => import("@/lib/config/config"))
      const config = yield* Config
      const threads = yield* ChatThreads
      const uploads = yield* Uploads
      const agents = yield* Agents
      const services = yield* Effect.context<
        | Effect.Services<ReturnType<typeof authenticateChatRequest>>
        | Effect.Services<ReturnType<typeof consumeRestRateLimit>>
      >()
      const authorize = Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
        const principal = yield* HttpServerRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap(authenticateChatRequest),
          Effect.provideContext(services),
        )
        yield* consumeRestRateLimit(
          "chat-uploads",
          [principal.organization.id, principal.tenantUser.tenant.id, principal.tenantUser.id],
          { limit: 120, window: "1 minute" },
        ).pipe(Effect.provideContext(services))
        return { principal, scope: yield* threads.resolveScope({ principal }) }
      })
      return handlers
        .handle(
          "prepareChatUpload",
          Effect.fn("prepareChatUpload")(function* ({ payload, request }) {
            const { principal, scope } = yield* authorize(request)
            if ((yield* config.get("storage_provider")) !== "s3") return yield* new UploadConflict()
            const grant = yield* agents.resolveForChat({
              organizationId: principal.organization.id,
              agentId: payload.agentId,
            })
            if (!grant.attachmentsEnabled) return yield* new ChatAttachmentsDisabled()
            return yield* uploads.prepare(scope, payload).pipe(provideClusterWorkflowEngine)
          }),
        )
        .handle(
          "getChatUpload",
          Effect.fn("getChatUpload")(function* ({ params, request }) {
            return yield* uploads.status((yield* authorize(request)).scope, params.id)
          }),
        )
        .handle(
          "signChatUploadParts",
          Effect.fn("signChatUploadParts")(function* ({ params, payload, request }) {
            return yield* uploads.sign((yield* authorize(request)).scope, params.id, payload.parts)
          }),
        )
        .handle(
          "completeChatUpload",
          Effect.fn("completeChatUpload")(function* ({ params, request }) {
            return yield* uploads
              .complete((yield* authorize(request)).scope, params.id)
              .pipe(provideClusterWorkflowEngine)
          }),
        )
        .handle(
          "cancelChatUpload",
          Effect.fn("cancelChatUpload")(function* ({ params, request }) {
            yield* uploads
              .cancel((yield* authorize(request)).scope, params.id)
              .pipe(provideClusterWorkflowEngine)
          }),
        )
        .handle(
          "cancelPreparedChatUpload",
          Effect.fn("cancelPreparedChatUpload")(function* ({ query, request }) {
            yield* uploads
              .cancelPrepared((yield* authorize(request)).scope, query.prepare_key)
              .pipe(provideClusterWorkflowEngine)
          }),
        )
    }),
  )
}
