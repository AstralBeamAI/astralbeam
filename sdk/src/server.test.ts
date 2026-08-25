import { jwtVerify } from "jose"
import { expect, test } from "vitest"

import {
  ASTRALBEAM_CHAT_TOKEN_AUDIENCE,
  ASTRALBEAM_CHAT_TOKEN_ISSUER,
  ASTRALBEAM_CHAT_TOKEN_TYPE,
  createAstralBeamChatToken,
} from "./server.ts"

const secret = "test-secret-with-at-least-thirty-two-bytes"

test("createAstralBeamChatToken mints the documented short-lived identity", async () => {
  const token = await createAstralBeamChatToken({
    secret,
    user: { id: " user-1 ", name: "Ada", email: "ada@example.com" },
    tenant: { id: "tenant-1", name: "Analytical Engines" },
  })
  const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: ASTRALBEAM_CHAT_TOKEN_ISSUER,
    audience: ASTRALBEAM_CHAT_TOKEN_AUDIENCE,
    algorithms: ["HS256"],
  })

  expect(protectedHeader.typ).toBe(ASTRALBEAM_CHAT_TOKEN_TYPE)
  expect(payload.sub).toBe("user-1")
  expect(payload.ver).toBe(1)
  expect(payload.user).toEqual({ id: "user-1", name: "Ada", email: "ada@example.com" })
  expect(payload.tenant).toEqual({ id: "tenant-1", name: "Analytical Engines" })
  expect(payload.exp! - payload.iat!).toBe(300)
})

test("createAstralBeamChatToken rejects weak secrets and excessive lifetimes", async () => {
  await expect(createAstralBeamChatToken({
    secret: "weak",
    user: { id: "user-1" },
    tenant: { id: "tenant-1" },
  })).rejects.toThrow(/at least 32 bytes/)
  await expect(createAstralBeamChatToken({
    secret,
    user: { id: "user-1" },
    tenant: { id: "tenant-1" },
    expiresInSeconds: 601,
  })).rejects.toThrow(/60-600 seconds/)
})
