import { Effect } from "effect"
import { SignJWT } from "jose"
import { expect, test, vi } from "vitest"

vi.mock("@/lib/constants", async (original) => ({
  ...await original<typeof import("@/lib/constants")>(),
  APP_HANDLE: "testbrand",
}))
vi.mock("@/db", () => ({ effectDatabase: Effect.void, runDatabaseEffect: Effect.runPromise }))

import { verifyOrganizationToken } from "./organization-token.server"

test("organization verification follows the deployment handle for type and audience", async () => {
  const organizationId = "01990a5d-ac96-774b-b942-6b13c85384ca"
  const keyId = `key_${organizationId}_01990a5d-ac96-774b-b942-6b13c85384c9`
  const key = new Uint8Array(32)
  const token = await new SignJWT({
    ver: 1,
    email: "operator@example.com",
    organization_id: organizationId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "testbrand-organization+jwt", kid: keyId })
    .setIssuer(organizationId)
    .setAudience("testbrand")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key)
  await expect(Effect.runPromise(verifyOrganizationToken(token, key, keyId))).resolves.toEqual({
    email: "operator@example.com",
    organizationId,
  })
})
