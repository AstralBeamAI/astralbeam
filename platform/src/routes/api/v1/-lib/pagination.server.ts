import { createHash, hkdfSync } from "node:crypto"
import { Effect, Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import type { DatabasePage, DatabasePageOptions } from "@/db/lib/pagination.server"
import { CompactSign, compactVerify, decodeProtectedHeader } from "jose"
import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "@/db/lib/database-credentials.server"
import { ApiUuidSchema } from "@/lib/tenants/schemas"
import { RestInvalidCursor } from "./errors.ts"
import type { RestPageQuery, RestScope } from "./shared.server"

const REST_CURSOR_TYPE = "pagination+jws"
const REST_CURSOR_MAX_LENGTH = 2048
const REST_CURSOR_KEY_SALT = new TextEncoder().encode("pagination-cursor:hkdf-sha256:v1")
const REST_CURSOR_KEY_INFO = new TextEncoder().encode("pagination-cursor:hs256:v1")

const decodeRestCursorPayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      binding: Schema.String,
      id: ApiUuidSchema,
      updatedAt: Schema.optional(Schema.String),
    }),
  ),
  { onExcessProperty: "error" },
)

export type RestCollection =
  | "tenants"
  | "tenant_users"
  | "chat_threads"
  | "chat_messages"
  | "chat_participants"
  | "chat_tenant_users"
type RestPaginationScope = RestScope["Service"] & {
  readonly tenantUserId?: string | undefined
  readonly threadId?: string | undefined
}
type RestCursorScope = RestPaginationScope & {
  externalId?: string | undefined
  search?: string | undefined
  admin?: boolean | undefined
}

interface RestCursorInput {
  readonly collection: RestCollection
  readonly scope: RestCursorScope
  readonly keyring?: DatabaseEncryptionKeyring | undefined
}

/** A signing failure is a server fault, so it reaches the boundary as a reported defect. */
class RestCursorSigningFailed extends Schema.TaggedError<RestCursorSigningFailed>()(
  "RestCursorSigningFailed",
  { cause: Schema.Defect() },
) {}

// A purpose-bound key keeps a cursor MAC from ever doubling as another use of the root.
function restCursorKey(root: Uint8Array): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", root, REST_CURSOR_KEY_SALT, REST_CURSOR_KEY_INFO, 32))
}

function restCursorBinding(collection: RestCollection, scope: RestCursorScope) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        collection,
        scope.organizationId,
        scope.externalTenantId ?? null,
        scope.tenantFilter ?? null,
        scope.externalId ?? null,
        scope.search ?? null,
        scope.admin ?? null,
        ...(collection.startsWith("chat_")
          ? [scope.tenantId, scope.tenantUserId, scope.threadId ?? null]
          : []),
      ]),
    )
    .digest("base64url")
}

export const encodeRestCursor = Effect.fn("encodeRestCursor")(function* (
  input: RestCursorInput & { readonly position: NonNullable<DatabasePageOptions["position"]> },
) {
  const [activeKey] = input.keyring ?? getDatabaseEncryptionKeyring()
  const cursor = {
    version: 1,
    binding: restCursorBinding(input.collection, input.scope),
    ...input.position,
  }
  return yield* Effect.tryPromise({
    try: () =>
      new CompactSign(new TextEncoder().encode(JSON.stringify(cursor)))
        .setProtectedHeader({ alg: "HS256", kid: activeKey.kid, typ: REST_CURSOR_TYPE })
        .sign(restCursorKey(activeKey.root)),
    catch: (cause) => new RestCursorSigningFailed({ cause }),
  }).pipe(Effect.orDie)
})

export const decodeRestCursor = Effect.fn("decodeRestCursor")(function* (
  input: RestCursorInput & { readonly cursor: string },
) {
  if (input.cursor.length > REST_CURSOR_MAX_LENGTH) return yield* new RestInvalidCursor()
  const header = yield* Effect.try({
    try: () => decodeProtectedHeader(input.cursor),
    catch: () => new RestInvalidCursor(),
  })
  const key = (input.keyring ?? getDatabaseEncryptionKeyring()).find(
    (entry) => entry.kid === header.kid,
  )
  if (header.typ !== REST_CURSOR_TYPE || header.alg !== "HS256" || !key) {
    return yield* new RestInvalidCursor()
  }
  const { payload } = yield* Effect.tryPromise({
    try: () => compactVerify(input.cursor, restCursorKey(key.root), { algorithms: ["HS256"] }),
    catch: () => new RestInvalidCursor(),
  })
  const decoded = yield* decodeRestCursorPayload(new TextDecoder().decode(payload)).pipe(
    Effect.mapError(() => new RestInvalidCursor()),
  )
  if (decoded.binding !== restCursorBinding(input.collection, input.scope)) {
    return yield* new RestInvalidCursor()
  }
  return { id: decoded.id, ...(decoded.updatedAt ? { updatedAt: decoded.updatedAt } : {}) }
})

export const restPageOptions = Effect.fn("restPageOptions")(function* (
  query: RestPageQuery & { "filter[admin]"?: "true" | "false" | undefined },
  collection: RestCollection,
  scope: RestPaginationScope,
) {
  const externalId = query["filter[external_id]"]
  const search = query.q?.trim() || undefined
  const admin = query["filter[admin]"] === undefined ? undefined : query["filter[admin]"] === "true"
  const cursor = query.page_after ?? query.page_before
  return {
    pageSize: query.page_size ?? 20,
    backward: query.page_before !== undefined,
    externalId,
    search,
    admin,
    position:
      cursor === undefined
        ? undefined
        : yield* decodeRestCursor({
            cursor,
            collection,
            scope: { ...scope, externalId, search, admin },
          }),
  }
})

export const restPage = Effect.fn("restPage")(function* <T>(
  page: DatabasePage<T>,
  options: {
    collection: RestCollection
    scope: RestPaginationScope
    url: string
    backward: boolean
    externalId?: string | undefined
    search?: string | undefined
    admin?: boolean | undefined
  },
) {
  const { collection, scope, url, backward, externalId, search, admin } = options
  const cursorFor = (position: DatabasePage<T>["nextPosition"]) =>
    position
      ? encodeRestCursor({
          position,
          collection,
          scope: { ...scope, externalId, search, admin },
        })
      : Effect.succeed(null)
  const page_after = yield* cursorFor(backward ? page.previousPosition : page.nextPosition)
  const page_before = yield* cursorFor(backward ? page.nextPosition : page.previousPosition)
  const links = []
  for (const [parameter, cursor, relation] of [
    ["page_after", page_after, "next"],
    ["page_before", page_before, "prev"],
  ] as const) {
    if (!cursor) continue
    const next = new URL(url, "http://localhost")
    next.searchParams.delete("page_after")
    next.searchParams.delete("page_before")
    next.searchParams.set(parameter, cursor)
    links.push(`<${next.pathname}${next.search}>; rel="${relation}"`)
  }
  return HttpApiSchema.withHeaders({
    body: { items: page.items, page_after, page_before },
    headers: links.length ? { Link: links.join(", ") } : {},
  })
})
