import { describe, expect, test } from "vitest"
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
describe("opaque pagination cursors", () => {
  test("maximum-length Unicode cursors fit the limit and survive retained-key rotation", async () => {
    const cursor = await encodeRestCursor(
      cursorPosition,
      "tenant_users",
      cursorScope,
      cursorOldKeyring,
    )
    expect(cursor.length).toBeLessThanOrEqual(2048)
    expect(await decodeRestCursor(cursor, "tenant_users", cursorScope, cursorRotatedKeyring))
      .toEqual(
        cursorPosition,
      )
    await expect(
      decodeRestCursor(
        cursor,
        "tenant_users",
        cursorScope,
        parseDatabaseEncryptionKeyring(cursorNewSecret),
      ),
    ).rejects.toThrow("Invalid pagination cursor")
  })
  test("rejects tampering, collection and scope changes", async () => {
    const cursor = await encodeRestCursor(
      cursorPosition,
      "tenant_users",
      cursorScope,
      cursorOldKeyring,
    )
    const parts = cursor.split(".")
    parts[2] = (parts[2]![0] === "A" ? "B" : "A") + parts[2]!.slice(1)
    for (const invalid of ["not-a-jws", parts.join(".")]) {
      await expect(decodeRestCursor(invalid, "tenant_users", cursorScope, cursorOldKeyring))
        .rejects.toThrow("Invalid pagination cursor")
    }
    await expect(decodeRestCursor(cursor, "tenants", cursorScope, cursorOldKeyring)).rejects
      .toThrow()
    for (
      const scope of [
        { ...cursorScope, organizationId: cursorPosition.id },
        { ...cursorScope, externalTenantId: "other" },
        { organizationId: cursorScope.organizationId },
        { ...cursorScope, externalId: "added-filter" },
        { ...cursorScope, tenantFilter: cursorPosition.id },
      ]
    ) {
      await expect(decodeRestCursor(cursor, "tenant_users", scope, cursorOldKeyring)).rejects
        .toThrow()
    }
  })
})
