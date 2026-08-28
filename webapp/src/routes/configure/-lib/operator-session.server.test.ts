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

  test("expires when the active database encryption key changes", async () => {
    const originalKey = new Uint8Array(32).fill(1)
    const changedKey = new Uint8Array(32).fill(2)
    const token = await createOperatorSession(originalKey)
    await expect(verifyOperatorSession(token, originalKey)).resolves.not.toBeNull()
    await expect(verifyOperatorSession(token, changedKey)).resolves.toBeNull()
  })
})
