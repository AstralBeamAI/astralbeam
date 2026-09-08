import { createHash } from "node:crypto"
import { Schema } from "effect"
import { CompactSign, compactVerify, decodeProtectedHeader } from "jose"
import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "@/db/lib/database-credentials.server"
import { ApiUuidSchema } from "@/api/management"
import type { RestScope } from "./contract.server"
import { restFault } from "./responses.server"

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
