import { base64url, jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  CHAT_AUTH_TOKEN_AUDIENCE,
  CHAT_AUTH_TOKEN_TYPE,
  CHAT_AUTH_TOKEN_VERSION,
  createChatAuthToken,
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

async function signingKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))
  return textEncoder.encode(base64url.encode(new Uint8Array(digest)))
}

test("createChatAuthToken mints the documented short-lived tenant identity", async () => {
  const user = {
    id: "user-1",
    name: "Ada",
    metadata: { roles: ["owner"] },
  }
  const token = await createChatAuthToken({ apiKey, user, tenant })
  const { payload, protectedHeader } = await jwtVerify(
    token,
    await signingKey(apiKeySecret),
    {
      issuer: "analytical-engines",
      audience: CHAT_AUTH_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    },
  )

  expect(protectedHeader).toMatchObject({
    typ: CHAT_AUTH_TOKEN_TYPE,
    kid: apiKeyId,
  })
  expect(payload.sub).toBeUndefined()
  expect(payload.iss).toBe("analytical-engines")
  expect(payload.aud).toBe(CHAT_AUTH_TOKEN_AUDIENCE)
  expect(payload.scope).toBeUndefined()
  expect(payload.ver).toBe(CHAT_AUTH_TOKEN_VERSION)
  expect(payload.user).toEqual(user)
  expect(payload.tenant).toEqual(tenant)
  expect(payload.tenantUser).toBeUndefined()
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createChatAuthToken validates the combined API key", async () => {
  await expect(createChatAuthToken({
    apiKey: `key_bad_org_production_abo_${"aB".repeat(32)}`,
    user: { id: "user-1" },
    tenant,
  })).rejects.toThrow(/key_<organization>_<key>_abo_<secret>/)
  await expect(createChatAuthToken({
    apiKey: `${apiKeyId}_notabo_${"aB".repeat(32)}`,
    user: { id: "user-1" },
    tenant,
  })).rejects.toThrow(/key_<organization>_<key>_abo_<secret>/)
})

test("createChatAuthToken preserves opaque tenant user IDs exactly", async () => {
  const id = " user-1 "
  const token = await createChatAuthToken({
    apiKey,
    user: { id },
    tenant: { id: " tenant-1 " },
  })
  const { payload } = await jwtVerify(token, await signingKey(apiKeySecret))

  expect(payload.user).toEqual({ id })
  expect(payload.tenant).toEqual({ id: " tenant-1 " })
})

test("createChatAuthToken rejects out-of-range lifetimes and tenant user IDs", async () => {
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "" },
    tenant,
  })).rejects.toThrow(/1-255 character string/)
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant,
    expiresInSeconds: 601,
  })).rejects.toThrow(/60-600 seconds/)
})

// Both cases are values the prop type already rejects; the assertion is that the runtime schema
// rejects them too, so `as never` is what lets the call be written at all.
test.each([
  ["class instances", { id: "user-1", metadata: { value: new Date() } }],
  ["toJSON hooks", { id: "user-1", toJSON: () => ({ id: "other" }) }],
])("createChatAuthToken rejects user %s", async (_label, user) => {
  await expect(createChatAuthToken({ apiKey, user: user as never, tenant })).rejects.toThrow()
})

test("createChatAuthToken accepts deeply nested metadata and rejects oversized identity data", async () => {
  type NestedJson = boolean | { child: NestedJson }
  let deep: NestedJson = true
  for (let level = 0; level < 50; level += 1) deep = { child: deep }

  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1", metadata: { deep } },
    tenant,
  })).resolves.toBeTypeOf("string")
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: { id: "tenant-1", metadata: { data: "x".repeat(8_192) } },
  })).rejects.toThrow(/8192 bytes/)
})

test("createChatAuthToken rejects fields outside the metadata objects", async () => {
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1", roles: ["owner"] } as never,
    tenant,
  })).rejects.toThrow(/roles/)
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: { id: "tenant-1", plan: "enterprise" } as never,
  })).rejects.toThrow(/plan/)
})

test("createChatAuthToken requires user and tenant and validates predefined fields", async () => {
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: undefined as never,
  })).rejects.toThrow(/tenant/)
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1" },
    tenant: { id: "" },
  })).rejects.toThrow(/tenant\.id/)
  await expect(createChatAuthToken({
    apiKey,
    user: { id: "user-1", admin: "yes" } as never,
    tenant,
  })).rejects.toThrow(/admin/)
})

test.each([true, false])(
  "createChatAuthToken preserves an explicit tenant administrator claim (%s)",
  async (admin) => {
    const token = await createChatAuthToken({
      apiKey,
      user: { id: "user-1", admin },
      tenant,
    })
    const { payload } = await jwtVerify(token, await signingKey(apiKeySecret))

    expect(payload.user).toEqual({ id: "user-1", admin })
  },
)
