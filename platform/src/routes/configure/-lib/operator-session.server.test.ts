import { createHmac } from "node:crypto"

import { SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { createOperatorSession, verifyOperatorSession } from "./operator-session.server"

describe("operator session boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-27T00:00:00.000Z"))
  })

  afterEach(() => vi.useRealTimers())

  test("accepts only an untampered token during its absolute lifetime", async () => {
    const token = await createOperatorSession()
    await expect(verifyOperatorSession(token)).resolves.toEqual({
      expiresAt: new Date("2026-08-27T00:15:00.000Z"),
    })

    const [header, payload, signature] = token.split(".")
    const tamperedSignature = `${signature?.startsWith("a") ? "b" : "a"}${signature?.slice(1)}`
    await expect(
      verifyOperatorSession(`${header}.${payload}.${tamperedSignature}`),
    ).resolves.toBeNull()

    vi.advanceTimersByTime(15 * 60 * 1_000 + 1)
    await expect(verifyOperatorSession(token)).resolves.toBeNull()
  })

  test("rejects signed tokens with invalid operator claims", async () => {
    const root = new Uint8Array(32).fill(1)
    const key = createHmac("sha256", root)
      .update("configure-operator-session-signing-key:v1\0")
      .digest()
    const iat = Math.floor(Date.now() / 1_000)
    for (const invalid of [
      { sub: "user" },
      { iat: iat + 0.5, exp: iat + 900.5 },
      { exp: iat + 901 },
      { typ: "JWT" },
      { typ: "OPERATOR-SESSION+JWT" },
    ]) {
      const { typ = "operator-session+jwt", ...claims } = invalid
      const token = await new SignJWT({ sub: "operator", iat, exp: iat + 900, ...claims })
        .setProtectedHeader({ alg: "HS256", typ })
        .setIssuer("configure")
        .setAudience("configure")
        .setJti("test")
        .sign(key)
      await expect(verifyOperatorSession(token, root)).resolves.toBeNull()
    }
  })

  test("expires when the active database encryption key changes", async () => {
    const originalKey = new Uint8Array(32).fill(1)
    const changedKey = new Uint8Array(32).fill(2)
    const token = await createOperatorSession(originalKey)
    await expect(verifyOperatorSession(token, originalKey)).resolves.not.toBeNull()
    await expect(verifyOperatorSession(token, changedKey)).resolves.toBeNull()
  })
})
