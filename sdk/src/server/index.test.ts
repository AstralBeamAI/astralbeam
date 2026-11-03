import { base64url, jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  CHAT_AUTH_TOKEN_AUDIENCE,
  CHAT_AUTH_TOKEN_TYPE,
  CHAT_AUTH_TOKEN_VERSION,
  createAstralBeamOrganizationToken,
  createAstralBeamToken,
} from "./index.ts"

const apiKeyId = "key_01990a5d-ac96-774b-b942-6b13c85384ca_01990a5d-ac96-774b-b942-6b13c85384c9"
const apiKeySecret = `abo_${"aB".repeat(32)}`
const apiKey = `${apiKeyId}_${apiKeySecret}`
const textEncoder = new TextEncoder()
const tenant = {
  id: "tenant-1",
  name: "Analytical Engines",
  metadata: { plan: "enterprise" },
}

test("organization token grants a separate, short-lived operator identity", async () => {
  const options = { apiKey, email: "operator@example.com", organizationId: apiKeyId.split("_")[1]! }
  const token = await createAstralBeamOrganizationToken(options)
  const { payload } = await jwtVerify(token, await signingKey(apiKeySecret), {
    typ: "astralbeam-organization+jwt",
    algorithms: ["HS256"],
    audience: "astralbeam",
  })
  const { iat, exp, ...claims } = payload
  expect(claims).toEqual({
    ver: 1,
    email: options.email,
    organization_id: options.organizationId,
    iss: options.organizationId,
    aud: "astralbeam",
  })
  expect(exp! - iat!).toBe(300)
  for (const expiresInSeconds of [59, 601, 60.5]) {
    await expect(
      createAstralBeamOrganizationToken({ ...options, expiresInSeconds }),
    ).rejects.toThrow()
  }
  for (const email of [
    "not-an-email",
    "owner\u0000@example.com",
    "a".repeat(309) + "@example.com",
  ]) {
    await expect(createAstralBeamOrganizationToken({ ...options, email })).rejects.toThrow()
  }
  await expect(
    createAstralBeamOrganizationToken({ ...options, organizationId: "another-org" }),
  ).rejects.toThrow("organizationId")
})

async function signingKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))
  return textEncoder.encode(base64url.encode(new Uint8Array(digest)))
}

test("createAstralBeamToken mints the documented short-lived tenant identity", async () => {
  const user = {
    id: "user-1",
    name: "Ada",
    metadata: { roles: ["owner"] },
  }
  const token = await createAstralBeamToken({ apiKey, user, tenant })
  const { payload, protectedHeader } = await jwtVerify(token, await signingKey(apiKeySecret), {
    issuer: "01990a5d-ac96-774b-b942-6b13c85384ca",
    audience: CHAT_AUTH_TOKEN_AUDIENCE,
    algorithms: ["HS256"],
  })

  expect(protectedHeader).toMatchObject({
    typ: CHAT_AUTH_TOKEN_TYPE,
    kid: apiKeyId,
  })
  expect(payload.sub).toBeUndefined()
  expect(payload.iss).toBe("01990a5d-ac96-774b-b942-6b13c85384ca")
  expect(payload.aud).toBe(CHAT_AUTH_TOKEN_AUDIENCE)
  expect(payload.scope).toBeUndefined()
  expect(payload.ver).toBe(CHAT_AUTH_TOKEN_VERSION)
  expect(payload.user).toEqual(user)
  expect(payload.tenant).toEqual(tenant)
  expect(payload.tenantUser).toBeUndefined()
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createAstralBeamToken lists usage limits once, and refuses IDs the server cannot match", async () => {
  const pro = "limit_01990a5d-ac96-774b-b942-6b13c85384ca_01990a5d-ac96-774b-b942-6b13c85384cb"
  const user = { id: "user-1" }
  const token = await createAstralBeamToken({ apiKey, user, tenant, usageLimits: [pro, pro] })
  const { payload } = await jwtVerify(token, await signingKey(apiKeySecret))
  expect(payload.usage_limits).toEqual([pro])
  for (const usageLimits of [["pro-weekly"], Array.from({ length: 21 }, () => pro)])
    await expect(createAstralBeamToken({ apiKey, user, tenant, usageLimits })).rejects.toThrow(
      "usageLimits must list at most 20 IDs",
    )
})

test("createAstralBeamToken preserves opaque tenant user IDs exactly", async () => {
  const id = " user-1 "
  const token = await createAstralBeamToken({
    apiKey,
    user: { id },
    tenant: { id: " tenant-1 " },
  })
  const { payload } = await jwtVerify(token, await signingKey(apiKeySecret))

  expect(payload.user).toEqual({ id })
  expect(payload.tenant).toEqual({ id: " tenant-1 " })
})

test("createAstralBeamToken accepts deeply nested metadata and rejects oversized identity data", async () => {
  type NestedJson = boolean | { child: NestedJson }
  let deep: NestedJson = true
  for (let level = 0; level < 50; level += 1) deep = { child: deep }

  await expect(
    createAstralBeamToken({
      apiKey,
      user: { id: "user-1", metadata: { deep } },
      tenant,
    }),
  ).resolves.toBeTypeOf("string")
  await expect(
    createAstralBeamToken({
      apiKey,
      user: { id: "user-1" },
      tenant: { id: "tenant-1", metadata: { data: "x".repeat(8_192) } },
    }),
  ).rejects.toThrow(/8192 bytes/)
})

test.each([
  ["legacy key", { apiKey: `key_analytical-engines_production-key_${apiKeySecret}` }],
  ["invalid prefix", { apiKey: `${apiKeyId}_notabo_${"aB".repeat(32)}` }],
  ["empty user ID", { user: { id: "" } }],
  ["excessive lifetime", { expiresInSeconds: 601 }],
  ["class metadata", { user: { id: "user-1", metadata: { value: new Date() } } }],
  ["serialization hook", { user: { id: "user-1", toJSON: () => ({ id: "other" }) } }],
  ["unknown user field", { user: { id: "user-1", roles: ["owner"] } }],
  ["unknown tenant field", { tenant: { id: "tenant-1", plan: "enterprise" } }],
  ["missing tenant", { tenant: undefined }],
  ["empty tenant ID", { tenant: { id: "" } }],
  ["invalid admin", { user: { id: "user-1", admin: "yes" } }],
])("refuses %s before minting", async (_name, invalid) => {
  await expect(
    createAstralBeamToken({ apiKey, user: { id: "user-1" }, tenant, ...invalid } as never),
  ).rejects.toThrow()
})

test.each([true, false])(
  "createAstralBeamToken preserves an explicit tenant administrator claim (%s)",
  async (admin) => {
    const token = await createAstralBeamToken({
      apiKey,
      user: { id: "user-1", admin },
      tenant,
    })
    const { payload } = await jwtVerify(token, await signingKey(apiKeySecret))

    expect(payload.user).toEqual({ id: "user-1", admin })
  },
)
