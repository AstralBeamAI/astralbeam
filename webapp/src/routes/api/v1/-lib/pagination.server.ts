import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import { HttpApiSchema } from "effect/unstable/httpapi"
import type { DatabasePage } from "@/db/lib/pagination.server"
import { CompactSign, compactVerify, decodeProtectedHeader } from "jose"
import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "@/db/lib/database-credentials.server"
import { ApiUuidSchema } from "@/api/management"
import type { RestPageQuery, RestScope } from "./shared.server"
import { RestFault, restFault } from "./responses.server"

const restCursorSchema = Schema.Struct({
  version: Schema.Literal(1),
  binding: Schema.String,
  id: ApiUuidSchema,
})
export type RestCollection = "tenants" | "tenant_users"
type RestCursorScope = RestScope & { externalId?: string | undefined }

function restCursorBinding(collection: RestCollection, scope: RestCursorScope) {
  return createHash("sha256").update(JSON.stringify([
    collection,
    scope.organizationId,
    scope.externalTenantId ?? null,
    scope.tenantFilter ?? null,
    scope.externalId ?? null,
  ])).digest("base64url")
}

export async function encodeRestCursor(
  position: { id: string },
  collection: RestCollection,
  scope: RestCursorScope,
  keyring: DatabaseEncryptionKeyring = getDatabaseEncryptionKeyring(),
): Promise<string> {
  const cursor = { version: 1, binding: restCursorBinding(collection, scope), id: position.id }
  return new CompactSign(new TextEncoder().encode(JSON.stringify(cursor)))
    .setProtectedHeader({ alg: "HS256", kid: keyring[0].kid, typ: "pagination+jws" })
    .sign(keyring[0].root)
}

export async function decodeRestCursor(
  cursor: string | undefined,
  collection: RestCollection,
  scope: RestCursorScope,
  keyring?: DatabaseEncryptionKeyring,
): Promise<{ id: string } | undefined> {
  if (cursor === undefined) return undefined
  try {
    const keys = keyring ?? getDatabaseEncryptionKeyring()
    if (cursor.length > 2048) throw new Error()
    const header = decodeProtectedHeader(cursor)
    if (header.typ !== "pagination+jws" || header.alg !== "HS256") throw new Error()
    const key = keys.find((entry) => entry.kid === header.kid)
    if (!key) throw new Error()
    const { payload: encoded } = await compactVerify(
      cursor,
      key.root,
      { algorithms: ["HS256"] },
    )
    const payload = Schema.decodeUnknownSync(Schema.fromJsonString(restCursorSchema), {
      onExcessProperty: "error",
    })(new TextDecoder().decode(encoded))
    if (payload.binding !== restCursorBinding(collection, scope)) throw new Error()
    return { id: payload.id }
  } catch {
    throw restFault(400, "Invalid pagination cursor.")
  }
}

export function restPageOptions(
  query: RestPageQuery,
  collection: RestCollection,
  scope: RestScope,
) {
  const externalId = query["filter[external_id]"]
  return Effect.tryPromise({
    try: async () => ({
      pageSize: query.page_size ?? 20,
      backward: query.page_before !== undefined,
      externalId,
      cursor: await decodeRestCursor(query.page_after ?? query.page_before, collection, {
        ...scope,
        externalId,
      }),
    }),
    catch: (error) =>
      error instanceof RestFault ? error : restFault(500, "Pagination could not be completed."),
  })
}

export async function restPage<T extends { id: string }>(
  page: DatabasePage<T>,
  collection: RestCollection,
  scope: RestScope,
  url: string,
  backward: boolean,
  externalId?: string,
) {
  const { items, nextPosition, previousPosition } = page
  const cursorFor = async (row: { id: string } | null | undefined) =>
    row ? await encodeRestCursor(row, collection, { ...scope, externalId }) : null
  const page_after = await cursorFor(backward ? previousPosition : nextPosition)
  const page_before = await cursorFor(backward ? nextPosition : previousPosition)
  const links = []
  for (
    const [parameter, cursor, relation] of [
      ["page_after", page_after, "next"],
      ["page_before", page_before, "prev"],
    ] as const
  ) {
    if (!cursor) continue
    const next = new URL(url, "http://localhost")
    next.searchParams.delete("page_after")
    next.searchParams.delete("page_before")
    next.searchParams.set(parameter, cursor)
    links.push(`<${next.pathname}${next.search}>; rel="${relation}"`)
  }
  const body = { items, page_after, page_before }
  const headers = links.length ? { Link: links.join(", ") } : {}
  return HttpApiSchema.withHeaders({ body, headers })
}
