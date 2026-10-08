import { and, eq, gt, isNotNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import { ApiUuidSchema } from "../../../../../lib/tenants/schemas.ts"
import {
  UploadInputSchema,
  UploadStatusSchema,
} from "../../../../../lib/chat/attachments/upload-schemas.ts"
import type { ApiV1 } from "../../-lib/contract.server"

const uploadParams = Schema.Struct({ id: ApiUuidSchema })
export const uploadApi = HttpApiGroup.make("uploads", { topLevel: true })
  .add(
    HttpApiEndpoint.post("prepareChatUpload", "/chat/uploads", {
      payload: UploadInputSchema,
      success: UploadStatusSchema,
    }).annotate(OpenApi.Summary, "Prepare a private file upload"),
    HttpApiEndpoint.get("getChatUpload", "/chat/uploads/:id", {
      params: uploadParams,
      success: UploadStatusSchema,
    }).annotate(OpenApi.Summary, "Read upload progress"),
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
    }).annotate(OpenApi.Summary, "Cancel an unclaimed upload"),
    HttpApiEndpoint.get("downloadStoredChatFile", "/chat/files/:id", {
      params: uploadParams,
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
        "Content-Disposition": Schema.String,
        "Content-Length": Schema.String,
      }),
    }).annotate(OpenApi.Summary, "Download a private conversation file"),
  )
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })

export function uploadHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "uploads",
    Effect.fn("uploadHandlers")(function* (handlers) {
      const { authenticateChatRequest } = yield* Effect.promise(
        () => import("@/lib/chat/auth.server"),
      )
      const { consumeRestRateLimit } = yield* Effect.promise(() => import("../../-lib/auth.server"))
      const { Agents } = yield* Effect.promise(() => import("@/lib/agents/agents.server"))
      const { ChatThreads } = yield* Effect.promise(
        () => import("@/lib/chat/threads/threads.server"),
      )
      const { Uploads } = yield* Effect.promise(
        () => import("@/lib/chat/attachments/uploads.server"),
      )
      const { UploadNotFound, UploadInvalid } = yield* Effect.promise(
        () => import("@/lib/chat/attachments/errors"),
      )
      const { ChatAttachmentsDisabled } = yield* Effect.promise(() => import("@/lib/chat/errors"))
      const { Database } = yield* Effect.promise(() => import("@/db/database.server"))
      const { chatFile, fileObject, fileUpload } = yield* Effect.promise(
        () => import("@/db/schema.server"),
      )
      const { mapDatabaseErrors } = yield* Effect.promise(() => import("@/db/lib/sqlstate.server"))
      const { Config } = yield* Effect.promise(() => import("@/lib/config/config.server"))
      const { chatStoredFileResponse } = yield* Effect.promise(() => import("./files.server"))
      const { CHAT_ATTACHMENT_MAX_TOTAL_BYTES } = yield* Effect.promise(
        () => import("@/lib/chat/attachments/constants.server"),
      )
      const threads = yield* ChatThreads
      const uploads = yield* Uploads
      const agents = yield* Agents
      const db = yield* Database
      const config = yield* Config
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
            const grant = yield* agents.resolveForChat({
              organizationId: principal.organization.id,
              agentId: payload.agentId,
            })
            if (!grant.attachmentsEnabled) return yield* new ChatAttachmentsDisabled()
            if (payload.byteSize > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
              return yield* new UploadInvalid()
            return yield* uploads.prepare(scope, payload)
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
            return yield* uploads.complete((yield* authorize(request)).scope, params.id)
          }),
        )
        .handle(
          "cancelChatUpload",
          Effect.fn("cancelChatUpload")(function* ({ params, request }) {
            yield* uploads.cancel((yield* authorize(request)).scope, params.id)
          }),
        )
        .handle(
          "downloadStoredChatFile",
          Effect.fn("downloadStoredChatFile")(function* ({ params, request }) {
            const { scope } = yield* authorize(request)
            const [owner] = yield* db
              .select()
              .from(chatFile)
              .where(
                and(
                  eq(chatFile.organizationId, scope.organizationId),
                  eq(chatFile.tenantId, scope.tenantId),
                  eq(chatFile.id, params.id),
                ),
              )
              .pipe(mapDatabaseErrors())
            let filename: string | undefined
            if (owner) yield* threads.get({ scope, id: owner.threadId })
            else {
              const [upload] = yield* db
                .select()
                .from(fileUpload)
                .where(
                  and(
                    eq(fileUpload.organizationId, scope.organizationId),
                    eq(fileUpload.tenantId, scope.tenantId),
                    eq(fileUpload.tenantUserId, scope.tenantUserId),
                    eq(fileUpload.fileId, params.id),
                    eq(fileUpload.status, "completed"),
                    gt(fileUpload.expiresAt, sql`now()`),
                    sql`not exists (select 1 from chat_file where id = ${params.id}::uuid)`,
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (!upload) return yield* new UploadNotFound()
              filename = upload.filename
            }
            const [file] = yield* db
              .select()
              .from(fileObject)
              .where(and(eq(fileObject.id, params.id), isNotNull(fileObject.verifiedAt)))
              .pipe(mapDatabaseErrors())
            if (!file) return yield* new UploadNotFound()
            return yield* chatStoredFileResponse(file, filename ?? "file").pipe(
              Effect.provideService(Config, config),
            )
          }),
        )
    }),
  )
}
