import { SignJWT } from "jose"
import { describe, expect, test } from "vitest"

import {
  authenticateChatRequest,
  isChatAuthenticationConfigurationError,
  isChatAuthenticationError,
} from "./auth.server"
import {
  CHAT_TOKEN_AUDIENCE,
  CHAT_TOKEN_ISSUER,
  CHAT_TOKEN_KEY_ID,
  CHAT_TOKEN_TYPE,
} from "./constants.server"

const secret = "test-secret-with-at-least-thirty-two-bytes"
const key = new TextEncoder().encode(secret)

interface TokenOverrides {
  algorithm?: "HS256" | "HS384"
  audience?: string
  expiresInSeconds?: number
  expiresAt?: number
  issuedAt?: number
  keyId?: string
  subject?: string
  type?: string
  userId?: string
  version?: number
}

async function token(overrides: TokenOverrides = {}) {
  const now = Math.floor(Date.now() / 1_000)
  const issuedAt = overrides.issuedAt ?? now
  const algorithm = overrides.algorithm ?? "HS256"
  return await new SignJWT({
    ver: overrides.version ?? 1,
    user: { id: overrides.userId ?? "user-1", name: "Ada" },
    tenant: { id: "tenant-1", name: "Analytical Engines" },
  })
    .setProtectedHeader({
      alg: algorithm,
      typ: overrides.type ?? CHAT_TOKEN_TYPE,
      kid: overrides.keyId ?? CHAT_TOKEN_KEY_ID,
    })
    .setIssuer(CHAT_TOKEN_ISSUER)
    .setAudience(overrides.audience ?? CHAT_TOKEN_AUDIENCE)
    .setSubject(overrides.subject ?? "user-1")
    .setIssuedAt(issuedAt)
    .setExpirationTime(overrides.expiresAt ?? issuedAt + (overrides.expiresInSeconds ?? 300))
    .sign(key)
}

function request(bearer?: string) {
  return new Request("https://chat.example/api/chat", {
    method: "POST",
    ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
  })
}

describe("chat bearer authentication", () => {
  test("preserves guest requests and verifies a complete identity", async () => {
    await expect(authenticateChatRequest(request(), undefined)).resolves.toEqual({ kind: "guest" })
    await expect(authenticateChatRequest(request(await token()), secret)).resolves.toEqual({
      kind: "authenticated",
      user: { id: "user-1", name: "Ada", email: undefined, avatarUrl: undefined },
      tenant: {
        id: "tenant-1",
        name: "Analytical Engines",
        logoUrl: undefined,
      },
    })
  })

  test("fails closed when authenticated requests cannot be verified", async () => {
    await expect(authenticateChatRequest(request(await token()), undefined)).rejects.toSatisfy(
      isChatAuthenticationConfigurationError,
    )
    await expect(authenticateChatRequest(request("malformed"), secret)).rejects.toSatisfy(
      isChatAuthenticationError,
    )
  })

  test.each([
    ["expired", { issuedAt: 1, expiresAt: 2 }],
    ["future dated", { issuedAt: Math.floor(Date.now() / 1_000) + 120 }],
    ["wrong audience", { audience: "another-service" }],
    ["wrong type", { type: "another+jwt" }],
    ["wrong key id", { keyId: "another-key" }],
    ["wrong algorithm", { algorithm: "HS384" as const }],
    ["subject mismatch", { subject: "another-user" }],
    ["wrong version", { version: 2 }],
    ["excessive lifetime", { expiresInSeconds: 601 }],
  ])("rejects %s tokens", async (_name, overrides) => {
    await expect(authenticateChatRequest(request(await token(overrides)), secret)).rejects
      .toSatisfy(isChatAuthenticationError)
  })
})
