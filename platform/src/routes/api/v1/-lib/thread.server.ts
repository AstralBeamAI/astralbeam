import { Effect, Schema } from "effect"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import type { ApiV1 } from "./contract.server"
import {
  RestScope,
  restPageFields,
  restPageHeaders,
  restPageQuery,
  restResourceSecurity,
} from "./shared.server"
import { ApiUuidSchema } from "../../../../lib/tenants/schemas.ts"
import { NonEmptyStringSchema } from "../../../../lib/schemas.ts"
import {
  chatMessageRecord,
  messageResource,
  savedChatAttachmentResponse,
} from "../chat/-lib/threads.server"
import type { DirectoryThreadRecord } from "../../../../lib/chat/threads/threads.server"

const directoryThreadDate = Schema.DateFromString.pipe(
  Schema.annotateEncoded({ format: "date-time" }),
)
const directoryThreadRecord = Schema.Struct({
  id: ApiUuidSchema,
  tenantId: ApiUuidSchema,
  tenantName: Schema.NullOr(Schema.String),
  tenantExternalId: Schema.String,
  title: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  createdAt: directoryThreadDate,
  updatedAt: directoryThreadDate,
}).pipe(
  Schema.annotate({ identifier: "DirectoryThread" }),
  Schema.encodeKeys({
    tenantId: "tenant_id",
    tenantName: "tenant_name",
    tenantExternalId: "tenant_external_id",
    agentId: "agent_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  }),
)
const directoryPageQuery = Schema.Struct({
  page_size: restPageQuery.fields.page_size,
  page_after: restPageQuery.fields.page_after,
  page_before: restPageQuery.fields.page_before,
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
)
const directoryThreadQuery = Schema.Struct({
  ...directoryPageQuery.fields,
  q: restPageQuery.fields.q,
  "filter[tenant_id]": Schema.optionalKey(ApiUuidSchema),
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
)
const directoryThreadParams = { tenantId: ApiUuidSchema, id: ApiUuidSchema }

export const threadDirectoryApi = HttpApiGroup.make("threadDirectory", { topLevel: true })
  .add(
    HttpApiEndpoint.get("listThreads", "/threads", {
      query: directoryThreadQuery,
      success: HttpApiSchema.WithHeaders(
        Schema.Struct({ items: Schema.Array(directoryThreadRecord), ...restPageFields }).annotate({
          identifier: "DirectoryThreadPage",
        }),
        restPageHeaders,
      ),
    })
      .annotate(OpenApi.Summary, "List conversations for administration")
      .annotate(
        OpenApi.Description,
        "List nonempty conversations by activity, Tenant ID and thread ID descending. q searches titles as a case-insensitive literal substring. filter[tenant_id] narrows the verified scope. Keep filters unchanged when reusing cursors. This is a live listing, not a snapshot.",
      ),
    HttpApiEndpoint.get("listThreadMessages", "/tenants/:tenantId/threads/:id/messages", {
      params: directoryThreadParams,
      query: directoryPageQuery,
      success: HttpApiSchema.WithHeaders(
        Schema.Struct({
          messages: Schema.Array(chatMessageRecord),
          thread: directoryThreadRecord,
          ...restPageFields,
        }).annotate({ identifier: "DirectoryThreadHistoryPage" }),
        restPageHeaders,
      ),
    }).annotate(OpenApi.Summary, "Read conversation history for administration"),
    HttpApiEndpoint.get(
      "getThreadAttachment",
      "/tenants/:tenantId/threads/:id/messages/:messageId/attachments/:partId",
      {
        params: {
          ...directoryThreadParams,
          messageId: ApiUuidSchema,
          partId: NonEmptyStringSchema,
        },
        success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
          "Content-Disposition": Schema.String,
          "Content-Length": Schema.String,
        }),
      },
    ).annotate(OpenApi.Summary, "Download a saved conversation upload for administration"),
  )
  .annotateEndpoints(OpenApi.Override, restResourceSecurity)
  .annotate(
    OpenApi.Description,
    "Read-only administrative access. Organization API keys and Organization-management JWTs with current directory-read permission can read their Organization. Signed Tenant admins can read only their Tenant. Administrative reads neither create participant grants nor authorize chat actions. Unknown and inaccessible conversations return the same 404. Saved uploads remain readable independently of the current agent configuration. Stored drafts do not imply a live producer.",
  )

function directoryThreadResource(row: DirectoryThreadRecord) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantExternalId: row.tenantExternalId,
    title: row.title,
    agentId: row.agentId === null ? null : `agent_${row.organizationId}_${row.agentId}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function threadDirectoryHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "threadDirectory",
    Effect.fn("threadDirectoryHandlers")(function* (handlers) {
      const { ChatThreads } = yield* Effect.promise(
        () => import("@/lib/chat/threads/threads.server"),
      )
      const { restPage, restPageOptions } = yield* Effect.promise(
        () => import("./pagination.server"),
      )
      const threads = yield* ChatThreads
      return handlers.handleAll({
        listThreads: Effect.fn("listThreads")(function* ({ query, request }) {
          const authorized = yield* RestScope
          const tenantFilter = query["filter[tenant_id]"]
          const scope = { ...authorized, tenantFilter }
          const options = yield* restPageOptions(query, "directory_threads", scope)
          // Preserve signed Tenant scope when a caller supplies a different filter.
          const tenantId =
            tenantFilter === undefined
              ? authorized.tenantId
              : authorized.tenantId === undefined || authorized.tenantId === tenantFilter
                ? tenantFilter
                : null
          const page = yield* threads.directoryList({
            ...options,
            scope: { ...authorized, tenantId },
          })
          return yield* restPage(
            { ...page, items: page.items.map(directoryThreadResource) },
            { ...options, scope, collection: "directory_threads", url: request.url },
          )
        }),
        listThreadMessages: Effect.fn("listThreadMessages")(function* ({ params, query, request }) {
          const scope = yield* RestScope
          const cursorScope = { ...scope, tenantFilter: params.tenantId, threadId: params.id }
          const options = yield* restPageOptions(query, "directory_messages", cursorScope)
          const { thread, messages } = yield* threads.directorySnapshot({
            ...params,
            scope,
            ...options,
          })
          const response = yield* restPage(
            { ...messages, items: messages.items.map(messageResource) },
            { ...options, scope: cursorScope, collection: "directory_messages", url: request.url },
          )
          return HttpApiSchema.withHeaders({
            body: {
              messages: response.body.items,
              thread: directoryThreadResource(thread),
              page_after: response.body.page_after,
              page_before: response.body.page_before,
            },
            headers: response.headers,
          })
        }),
        getThreadAttachment: Effect.fn("getThreadAttachment")(function* ({ params }) {
          const message = yield* threads.directoryMessage({ ...params, scope: yield* RestScope })
          return yield* savedChatAttachmentResponse(message, params.partId)
        }),
      })
    }),
  )
}
