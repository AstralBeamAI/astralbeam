import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { RateLimiter } from "effect/unstable/persistence"
import { beforeEach, describe, expect, test, vi } from "vitest"

const rateLimiter = vi.hoisted(() => ({ consume: vi.fn(), reset: vi.fn() }))

vi.mock("@/db/lib/rate-limiter.server", () => ({ databaseRateLimiter: rateLimiter }))

import {
  clearOperatorLoginRateLimit,
  consumeOperatorLoginRateLimit,
} from "./login-rate-limit.server.ts"

function storeFailure(code: string) {
  return Effect.fail(
    new RateLimiter.RateLimiterError({
      reason: new RateLimiter.RateLimitStoreError({
        message: "Rate-limit database operation failed",
        cause: { code },
      }),
    }),
  )
}

describe("configure login rate limit", () => {
  beforeEach(() => vi.resetAllMocks())

  test("skips consume and reset while the table is missing", async () => {
    rateLimiter.consume.mockReturnValue(storeFailure("42P01"))
    rateLimiter.reset.mockReturnValue(storeFailure("42P01"))

    await expect(Effect.runPromise(consumeOperatorLoginRateLimit())).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
    await expect(Effect.runPromise(clearOperatorLoginRateLimit())).resolves.toBeUndefined()
  })

  test("does not swallow other store failures", async () => {
    rateLimiter.consume.mockReturnValue(storeFailure("08006"))

    expect(Exit.isFailure(await Effect.runPromiseExit(consumeOperatorLoginRateLimit()))).toBe(true)
  })
})
