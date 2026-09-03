import { createHash } from "node:crypto"

import { jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  ASTRALBEAM_CHAT_TOKEN_SCOPE,
  ASTRALBEAM_CHAT_TOKEN_TYPE,
  ASTRALBEAM_CHAT_TOKEN_VERSION,
  ASTRALBEAM_TOKEN_AUDIENCE,
  createAstralBeamChatToken,
} from "./index.ts"

const apiKeyId = "key_analyticalengines_production"
const apiKeySecret = `abo_${"aB".repeat(32)}`
const apiKey = `${apiKeyId}_${apiKeySecret}`
const textEncoder = new TextEncoder()
const tenant = { id: "tenant-1", name: "Analytical Engines", plan: "enterprise" }

function signingKey(secret: string): Uint8Array {
  return textEncoder.encode(createHash("sha256").update(secret).digest("base64url"))
}

test("createAstralBeamChatToken mints the documented short-lived tenant identity", async () => {
  const tenantUser = {
    id: "user-1",
    name: "Ada",
    tenant,
    roles: ["owner"],
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
  expect(payload.scope).toEqual([ASTRALBEAM_CHAT_TOKEN_SCOPE])
  expect(payload.ver).toBe(ASTRALBEAM_CHAT_TOKEN_VERSION)
  expect(payload.tenantUser).toEqual(tenantUser)
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createAstralBeamChatToken validates the combined API key", async () => {
  await expect(createAstralBeamChatToken({
    apiKey: `key_bad-org_production_abo_${"aB".repeat(32)}`,
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

test("createAstralBeamChatToken uses the API key's organization slug as issuer", async () => {
  const token = await createAstralBeamChatToken({
    apiKey: `key_other_production_${apiKeySecret}`,
    tenantUser: { id: "user-1", tenant: { id: "tenant-1" } },
  })
  const { payload } = await jwtVerify(token, signingKey(apiKeySecret), {
    issuer: "other",
    audience: ASTRALBEAM_TOKEN_AUDIENCE,
  })

  expect(payload.iss).toBe("other")
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
  ["non-finite numbers", { id: "user-1", tenant, value: Number.NaN }],
  ["class instances", { id: "user-1", tenant, value: new Date() }],
  ["functions", { id: "user-1", tenant, value: () => undefined }],
  ["toJSON hooks", { id: "user-1", tenant, toJSON: () => ({ id: "other" }) }],
])("createAstralBeamChatToken rejects tenantUser %s", async (_label, tenantUser) => {
  await expect(createAstralBeamChatToken({ apiKey, tenantUser })).rejects.toThrow(
    /tenantUser/,
  )
})

test("createAstralBeamChatToken rejects sparse, cyclic, deeply nested, and oversized tenant data", async () => {
  const sparse = new Array(2)
  sparse[0] = "present"
  const cyclic: { id: string; tenant: typeof tenant; self?: unknown } = { id: "user-1", tenant }
  cyclic.self = cyclic
  let deep: unknown = true
  for (let level = 0; level < 9; level += 1) deep = { child: deep }

  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, sparse },
  })).rejects.toThrow(/sparse/)
  await expect(createAstralBeamChatToken({ apiKey, tenantUser: cyclic })).rejects.toThrow(
    /tenantUser/,
  )
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, deep },
  })).rejects.toThrow(/10 levels/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", tenant, data: "x".repeat(8_192) },
  })).rejects.toThrow(/8192 bytes/)
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
