import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { base64url, CompactSign, decodeProtectedHeader } from "jose"
import { parseDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { decodeRestCursor, encodeRestCursor } from "./pagination.server"

const cursorOldSecret = "old-pagination-test-key-not-production"
const cursorNewSecret = "new-pagination-test-key-not-production"
const cursorOldKeyring = parseDatabaseEncryptionKeyring(cursorOldSecret)
const cursorRotatedKeyring = parseDatabaseEncryptionKeyring(cursorNewSecret + "," + cursorOldSecret)
const cursorScope = {
  organizationId: "019a0000-0000-7000-8000-000000000001",
  externalTenantId: "東".repeat(255),
  externalId: "京".repeat(255),
  tenantFilter: "019a0000-0000-7000-8000-000000000002",
}
const cursorPosition = {
  id: "019a0000-0000-4000-8000-000000000003",
}
const collection = "tenant_users"

const rejected = (cursor: string, input: Partial<Parameters<typeof decodeRestCursor>[0]> = {}) =>
  decodeRestCursor({
    cursor,
    collection,
    scope: cursorScope,
    keyring: cursorOldKeyring,
    ...input,
  }).pipe(
    Effect.flip,
    Effect.map((error) => assert.strictEqual(error._tag, "RestInvalidCursor")),
  )

describe("opaque pagination cursors", () => {
  it.effect.each([cursorPosition, { ...cursorPosition, updatedAt: "2026-10-05T12:00:00.000Z" }])(
    "maximum-length Unicode cursors retain positions across key rotation: %j",
    (position) =>
      Effect.gen(function* () {
        const cursor = yield* encodeRestCursor({
          position,
          collection,
          scope: cursorScope,
          keyring: cursorOldKeyring,
        })
        assert.isAtMost(cursor.length, 2048)
        const decoded = yield* decodeRestCursor({
          cursor,
          collection,
          scope: cursorScope,
          keyring: cursorRotatedKeyring,
        })
        assert.deepStrictEqual(decoded, position)
        yield* rejected(cursor, { keyring: parseDatabaseEncryptionKeyring(cursorNewSecret) })
      }),
  )

  it.effect("rejects tampering, collection and scope changes", () =>
    Effect.gen(function* () {
      const cursor = yield* encodeRestCursor({
        position: cursorPosition,
        collection,
        scope: cursorScope,
        keyring: cursorOldKeyring,
      })
      const parts = cursor.split(".")
      parts[2] = (parts[2]![0] === "A" ? "B" : "A") + parts[2]!.slice(1)
      for (const invalid of ["not-a-jws", parts.join(".")]) yield* rejected(invalid)
      yield* rejected(cursor, { collection: "tenants" })
      for (const scope of [
        { ...cursorScope, organizationId: cursorPosition.id },
        { ...cursorScope, externalTenantId: "other" },
        { organizationId: cursorScope.organizationId },
        { ...cursorScope, externalId: "added-filter" },
        { ...cursorScope, tenantFilter: cursorPosition.id },
        { ...cursorScope, search: "name" },
        { ...cursorScope, admin: false },
      ]) {
        yield* rejected(cursor, { scope })
      }
    }),
  )

  it.effect("signs with a purpose-bound key, never the raw encryption root", () =>
    Effect.gen(function* () {
      const cursor = yield* encodeRestCursor({
        position: cursorPosition,
        collection,
        scope: cursorScope,
        keyring: cursorOldKeyring,
      })
      const rootSigned = yield* Effect.promise(() =>
        new CompactSign(base64url.decode(cursor.split(".")[1]!))
          .setProtectedHeader({ alg: "HS256", ...decodeProtectedHeader(cursor) })
          .sign(cursorOldKeyring[0].root),
      )
      yield* rejected(rootSigned)
    }),
  )

  it.effect("binds search and admin filters even when admin is false", () =>
    Effect.gen(function* () {
      const scope = { ...cursorScope, search: "東京_%", admin: false }
      const cursor = yield* encodeRestCursor({
        position: cursorPosition,
        collection,
        scope,
        keyring: cursorOldKeyring,
      })
      const decoded = yield* decodeRestCursor({
        cursor,
        collection,
        scope,
        keyring: cursorOldKeyring,
      })
      assert.deepStrictEqual(decoded, cursorPosition)
      for (const changed of [
        { ...scope, search: "東京" },
        { ...scope, admin: true },
        cursorScope,
      ]) {
        yield* rejected(cursor, { scope: changed })
      }
    }),
  )
})
