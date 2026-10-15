import { Effect } from "effect"
import { createHash } from "node:crypto"
import { createAstralBeamOrganizationToken } from "@astralbeam/sdk/server"
import { expect, test } from "vitest"

import { verifyOrganizationToken } from "./organization-token.server"

test("organization verification accepts SDK-issued tokens", async () => {
  const organizationId = "01990a5d-ac96-774b-b942-6b13c85384ca"
  const keyId = `key_${organizationId}_01990a5d-ac96-774b-b942-6b13c85384c9`
  const secret = `abo_${"A".repeat(64)}`
  const key = new TextEncoder().encode(createHash("sha256").update(secret).digest("base64url"))
  const options = {
    apiKey: `${keyId}_${secret}`,
    email: "operator@example.com",
    organizationId,
  }
  const token = await createAstralBeamOrganizationToken(options)
  await expect(Effect.runPromise(verifyOrganizationToken(token, key, keyId))).resolves.toEqual({
    email: "operator@example.com",
    organizationId,
  })
})
