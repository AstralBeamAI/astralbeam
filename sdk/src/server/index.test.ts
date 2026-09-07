import { createHash } from "node:crypto"

import { jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  ASTRALBEAM_CHAT_TOKEN_TYPE,
  ASTRALBEAM_CHAT_TOKEN_VERSION,
  ASTRALBEAM_TOKEN_AUDIENCE,
  createAstralBeamAuthToken,
} from "./index.ts"

const apiKeyId = "key_analytical-engines_production-key"
const apiKeySecret = `abo_${"aB".repeat(32)}`
const apiKey = `${apiKeyId}_${apiKeySecret}`
const textEncoder = new TextEncoder()
const tenant = {
  id: "tenant-1",
  name: "Analytical Engines",
  metadata: { plan: "enterprise" },
}

function signingKey(secret: string): Uint8Array {
  return textEncoder.encode(createHash("sha256").update(secret).digest("base64url"))
}

test("createAstralBeamAuthToken mints the documented short-lived tenant identity", async () => {
  const user = {
    id: "user-1",
    name: "Ada",
    metadata: { roles: ["owner"] },
  }
  const token = await createAstralBeamAuthToken({ apiKey, user, tenant })
  const { payload, protectedHeader } = await jwtVerify(
    token,
    signingKey(apiKeySecret),
    {
      issuer: "analytical-engines",
      audience: ASTRALBEAM_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    },
  )

  expect(protectedHeader).toMatchObject({
    typ: ASTRALBEAM_CHAT_TOKEN_TYPE,
    kid: apiKeyId,
  })
  expect(payload.sub).toBeUndefined()
  expect(payload.iss).toBe("analytical-engines")
  expect(payload.aud).toBe(ASTRALBEAM_TOKEN_AUDIENCE)
  expect(payload.scope).toBeUndefined()
  expect(payload.ver).toBe(ASTRALBEAM_CHAT_TOKEN_VERSION)
  expect(payload.user).toEqual(user)
  expect(payload.tenant).toEqual(tenant)
  expect(payload.tenantUser).toBeUndefined()
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createAstralBeamAuthToken validates the combined API key", async () => {
  await expect(createAstralBeamAuthToken({
    apiKey: `key_bad_org_production_abo_${"aB".repeat(32)}`,
    user: { id: "user-1" },
    tenant,
  })).rejects.toThrow(/key_<organization>_<key>_abo_<secret>/)
  await expect(createAstralBeamAuthToken({
    apiKey: `${apiKeyId}_notabo_${"aB".repeat(32)}`,
    user: { id: "user-1" },
    tenant,
  })).rejects.toThrow(/key_<organization>_<key>_abo_<secret>/)
})

test("createAstralBeamAuthToken preserves opaque tenant user IDs exactly", async () => {
  const id = " user-1 "
  const token = await createAstralBeamAuthToken({
    apiKey,
    user: { id },
    tenant: { id: " tenant-1 " },
  })
  const { payload } = await jwtVerify(token, signingKey(apiKeySecret))

  expect(payload.user).toEqual({ id })
  expect(payload.tenant).toEqual({ id: " tenant-1 " })
})

test("createAstralBeamAuthToken rejects out-of-range lifetimes and tenant user IDs", async () => {
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "" },
    tenant,
  })).rejects.toThrow(/1-255 character string/)
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant,
    expiresInSeconds: 601,
  })).rejects.toThrow(/60-600 seconds/)
})

test.each([
  ["class instances", { id: "user-1", metadata: { value: new Date() } }],
  ["toJSON hooks", { id: "user-1", toJSON: () => ({ id: "other" }) }],
])("createAstralBeamAuthToken rejects user %s", async (_label, user) => {
  await expect(createAstralBeamAuthToken({ apiKey, user, tenant })).rejects.toThrow()
})

test("createAstralBeamAuthToken accepts deeply nested metadata and rejects oversized identity data", async () => {
  let deep: unknown = true
  for (let level = 0; level < 50; level += 1) deep = { child: deep }

  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1", metadata: { deep } },
    tenant,
  })).resolves.toBeTypeOf("string")
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: { id: "tenant-1", metadata: { data: "x".repeat(8_192) } },
  })).rejects.toThrow(/8192 bytes/)
})

test("createAstralBeamAuthToken rejects fields outside the metadata objects", async () => {
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1", roles: ["owner"] } as never,
    tenant,
  })).rejects.toThrow(/roles/)
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: { id: "tenant-1", plan: "enterprise" } as never,
  })).rejects.toThrow(/plan/)
})

test("createAstralBeamAuthToken requires user and tenant and validates predefined fields", async () => {
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: undefined as never,
  })).rejects.toThrow(/tenant/)
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: { id: "" },
  })).rejects.toThrow(/tenant\.id/)
  await expect(createAstralBeamAuthToken({
    apiKey,
    user: { id: "user-1", admin: "yes" } as never,
    tenant,
  })).rejects.toThrow(/admin/)
})

test.each([true, false])(
  "createAstralBeamAuthToken preserves an explicit tenant administrator claim (%s)",
  async (admin) => {
    const token = await createAstralBeamAuthToken({
      apiKey,
      user: { id: "user-1", admin },
      tenant,
    })
    const { payload } = await jwtVerify(token, signingKey(apiKeySecret))

    expect(payload.user).toEqual({ id: "user-1", admin })
  },
)
