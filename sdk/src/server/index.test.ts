import { createHash } from "node:crypto"

import { jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  ASTRALBEAM_CHAT_TOKEN_TYPE,
  ASTRALBEAM_CHAT_TOKEN_VERSION,
  ASTRALBEAM_TOKEN_AUDIENCE,
  createAstralBeamChatToken,
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

test("createAstralBeamChatToken mints the documented short-lived tenant identity", async () => {
  const tenantUser = {
    id: "user-1",
    name: "Ada",
    tenant,
    metadata: { roles: ["owner"] },
  }
  const token = await createAstralBeamChatToken({ apiKey, tenantUser })
  const { payload, protectedHeader } = await jwtVerify(
    token,
    signingKey(apiKeySecret),
    {
      issuer: "analyticalengines",
      audience: ASTRALBEAM_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    },
  )

  expect(protectedHeader).toMatchObject({
    typ: ASTRALBEAM_CHAT_TOKEN_TYPE,
    kid: apiKeyId,
  })
  expect(payload.sub).toBeUndefined()
  expect(payload.iss).toBe("analyticalengines")
  expect(payload.aud).toBe(ASTRALBEAM_TOKEN_AUDIENCE)
  expect(payload.scope).toBeUndefined()
  expect(payload.ver).toBe(ASTRALBEAM_CHAT_TOKEN_VERSION)
  expect(payload.tenantUser).toEqual(tenantUser)
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createAstralBeamChatToken validates the combined API key", async () => {
  await expect(createAstralBeamChatToken({
    apiKey: `key_bad_org_production_abo_${"aB".repeat(32)}`,
    tenantUser: { id: "user-1", tenant },
  })).rejects.toThrow(/key_<organization>_<key>_abo_<secret>/)
  await expect(createAstralBeamChatToken({
    apiKey: `${apiKeyId}_notabo_${"aB".repeat(32)}`,
    tenantUser: { id: "user-1", tenant },
  })).rejects.toThrow(/key_<organization>_<key>_abo_<secret>/)
})

test("createAstralBeamChatToken preserves opaque tenant user IDs exactly", async () => {
  const id = " user-1 "
  const token = await createAstralBeamChatToken({
    apiKey,
    tenantUser: { id, tenant: { id: " tenant-1 " } },
  })
  const { payload } = await jwtVerify(token, signingKey(apiKeySecret))

  expect(payload.sub).toBeUndefined()
  expect(payload.tenantUser).toEqual({ id, tenant: { id: " tenant-1 " } })
})

test("createAstralBeamChatToken rejects out-of-range lifetimes and tenant user IDs", async () => {
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "", tenant },
  })).rejects.toThrow(/1-255 character string/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant },
    expiresInSeconds: 601,
  })).rejects.toThrow(/60-600 seconds/)
})

test.each([
  ["class instances", { id: "user-1", tenant, metadata: { value: new Date() } }],
  ["toJSON hooks", { id: "user-1", tenant, toJSON: () => ({ id: "other" }) }],
])("createAstralBeamChatToken rejects tenantUser %s", async (_label, tenantUser) => {
  await expect(createAstralBeamChatToken({ apiKey, tenantUser })).rejects.toThrow()
})

test("createAstralBeamChatToken rejects deeply nested and oversized tenant data", async () => {
  let deep: unknown = true
  for (let level = 0; level < 9; level += 1) deep = { child: deep }

  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, metadata: { deep } },
  })).rejects.toThrow(/10 levels/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, metadata: { data: "x".repeat(8_192) } },
  })).rejects.toThrow(/8192 bytes/)
})

test("createAstralBeamChatToken rejects fields outside the metadata objects", async () => {
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, roles: ["owner"] } as never,
  })).rejects.toThrow(/roles/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant: { id: "tenant-1", plan: "enterprise" } } as never,
  })).rejects.toThrow(/plan/)
})

test("createAstralBeamChatToken requires a tenant and validates predefined fields", async () => {
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1" } as never,
  })).rejects.toThrow(/tenant/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant: { id: "" } },
  })).rejects.toThrow(/tenantUser\.tenant\.id/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, admin: "yes" } as never,
  })).rejects.toThrow(/admin/)
})

test.each([true, false])(
  "createAstralBeamChatToken preserves an explicit tenant administrator claim (%s)",
  async (admin) => {
    const token = await createAstralBeamChatToken({
      apiKey,
      tenantUser: { id: "user-1", tenant, admin },
    })
    const { payload } = await jwtVerify(token, signingKey(apiKeySecret))

    expect(payload.tenantUser).toEqual({ id: "user-1", tenant, admin })
  },
)
