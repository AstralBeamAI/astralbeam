import { Effect } from "effect"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
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
  const secret = `abo_${"A".repeat(64)}`
  const key = new TextEncoder().encode(createHash("sha256").update(secret).digest("base64url"))
  const options = {
    apiKey: `${keyId}_${secret}`,
    email: "operator@example.com",
    organizationId,
  }
  // Each project owns its Deno dependencies. Mint through the SDK's own runtime configuration.
  const token = execFileSync("deno", [
    "eval",
    "--frozen",
    "--node-modules-dir=none",
    `import { createAstralBeamOrganizationToken as mint } from "./src/server/index.ts";
    const options = ${JSON.stringify(options)};
    console.log(await mint({...options, appHandle:"testbrand"}));`,
  ], { cwd: fileURLToPath(new URL("../../../sdk", import.meta.url)), encoding: "utf8" }).trim()
  await expect(Effect.runPromise(verifyOrganizationToken(token, key, keyId))).resolves.toEqual({
    email: "operator@example.com",
    organizationId,
  })
})
