import { createHash } from "node:crypto"

import { jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  ASTRALBEAM_CHAT_TOKEN_AUDIENCE,
  ASTRALBEAM_CHAT_TOKEN_ISSUER,
  ASTRALBEAM_CHAT_TOKEN_TYPE,
  ASTRALBEAM_CHAT_TOKEN_VERSION,
  createAstralBeamChatToken,
} from "./server.ts"

const apiKeyId = "key_analyticalengines_production"
const apiKeySecret = `abo_production_${"aB".repeat(32)}`
const apiKey = `${apiKeyId}_${apiKeySecret}`
const textEncoder = new TextEncoder()

function signingKey(secret: string): Uint8Array {
  return textEncoder.encode(createHash("sha256").update(secret).digest("base64url"))
}

test("createAstralBeamChatToken mints the documented short-lived tenant identity", async () => {
  const tenantUser = {
    id: "user-1",
    name: "Ada",
    tenant: { id: "tenant-1", name: "Analytical Engines" },
    roles: ["owner"],
  }
  const token = await createAstralBeamChatToken({ apiKey, tenantUser })
  const { payload, protectedHeader } = await jwtVerify(
    token,
    signingKey(apiKeySecret),
    {
      issuer: ASTRALBEAM_CHAT_TOKEN_ISSUER,
      audience: ASTRALBEAM_CHAT_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    },
  )

  expect(protectedHeader).toMatchObject({
    typ: ASTRALBEAM_CHAT_TOKEN_TYPE,
    kid: apiKeyId,
  })
  expect(payload.sub).toBe(tenantUser.id)
  expect(payload.ver).toBe(ASTRALBEAM_CHAT_TOKEN_VERSION)
  expect(payload.tenantUser).toEqual(tenantUser)
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createAstralBeamChatToken validates the combined API key", async () => {
  await expect(createAstralBeamChatToken({
    apiKey: `key_bad-org_production_abo_${"aB".repeat(32)}`,
    tenantUser: { id: "user-1" },
  })).rejects.toThrow(/key_<organization>_<key>_abo_<key>_<secret>/)
  await expect(createAstralBeamChatToken({
    apiKey: `${apiKeyId}_abo_staging_${"aB".repeat(32)}`,
    tenantUser: { id: "user-1" },
  })).rejects.toThrow(/key_<organization>_<key>_abo_<key>_<secret>/)
})

test("createAstralBeamChatToken preserves opaque tenant user IDs exactly", async () => {
  const id = " user-1 "
  const token = await createAstralBeamChatToken({
    apiKey,
    tenantUser: { id },
  })
  const { payload } = await jwtVerify(token, signingKey(apiKeySecret))

  expect(payload.sub).toBe(id)
  expect(payload.tenantUser).toEqual({ id })
})

test("createAstralBeamChatToken rejects out-of-range lifetimes and tenant user IDs", async () => {
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "" },
  })).rejects.toThrow(/1-255 character string/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1" },
    expiresInSeconds: 601,
  })).rejects.toThrow(/60-600 seconds/)
})

test.each([
  ["non-finite numbers", { id: "user-1", value: Number.NaN }],
  ["class instances", { id: "user-1", value: new Date() }],
  ["functions", { id: "user-1", value: () => undefined }],
  ["toJSON hooks", { id: "user-1", toJSON: () => ({ id: "other" }) }],
])("createAstralBeamChatToken rejects tenantUser %s", async (_label, tenantUser) => {
  await expect(createAstralBeamChatToken({ apiKey, tenantUser })).rejects.toThrow(
    /tenantUser/,
  )
})

test("createAstralBeamChatToken rejects sparse, cyclic, deeply nested, and oversized tenant data", async () => {
  const sparse = new Array(2)
  sparse[0] = "present"
  const cyclic: { id: string; self?: unknown } = { id: "user-1" }
  cyclic.self = cyclic
  let deep: unknown = true
  for (let level = 0; level < 9; level += 1) deep = { child: deep }

  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", sparse },
  })).rejects.toThrow(/sparse/)
  await expect(createAstralBeamChatToken({ apiKey, tenantUser: cyclic })).rejects.toThrow(
    /tenantUser/,
  )
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", deep },
  })).rejects.toThrow(/10 levels/)
  await expect(createAstralBeamChatToken({
    apiKey,
    tenantUser: { id: "user-1", data: "x".repeat(8_192) },
  })).rejects.toThrow(/8192 bytes/)
})
