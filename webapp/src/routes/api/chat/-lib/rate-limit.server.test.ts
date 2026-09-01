import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { RateLimiter } from "effect/unstable/persistence"
import { beforeEach, expect, test, vi } from "vitest"

const consume = vi.hoisted(() => vi.fn())

vi.mock("@/db/lib/rate-limiter.server", () => ({
  databaseRateLimiter: { consume },
}))

import { consumeChatRateLimit } from "./rate-limit.server"

beforeEach(() => {
  consume.mockReset()
  consume.mockReturnValue(Effect.succeed({
    delay: Duration.zero,
    limit: 20,
    remaining: 19,
    resetAfter: Duration.seconds(60),
  }))
})

test("isolates opaque rate-limit buckets by organization and tenant user", async () => {
  const principals = [
    principal("organization-1", "tenant-user-1"),
    principal("organization-1", "tenant-user-2"),
    principal("organization-2", "tenant-user-1"),
    principal("organization-1", "tenant-user-1"),
  ]
  for (const value of principals) {
    await expect(runMockedRateLimit(consumeChatRateLimit(value))).resolves.toBe(false)
  }

  const keys = consume.mock.calls.map((call) => rateLimitKey(call[0] as unknown))
  expect(new Set(keys.slice(0, 3)).size).toBe(3)
  expect(keys[3]).toBe(keys[0])
  expect(keys.every((key) => key.startsWith("chat:") && !key.includes("tenant-user"))).toBe(true)
})

test("propagates rate-limit store failures", async () => {
  consume.mockReturnValue(Effect.fail(
    new RateLimiter.RateLimiterError({
      reason: new RateLimiter.RateLimitStoreError({ message: "unavailable" }),
    }),
  ))

  const error = await runMockedRateLimit(
    consumeChatRateLimit(principal("organization-1", "tenant-user-1")).pipe(Effect.flip),
  )
  expect(error.reason._tag).toBe("RateLimitStoreError")
})

test("reports an exceeded bucket to the chat route", async () => {
  consume.mockReturnValue(Effect.fail(
    new RateLimiter.RateLimiterError({
      reason: new RateLimiter.RateLimitExceeded({
        key: "chat:opaque",
        limit: 20,
        remaining: 0,
        retryAfter: Duration.seconds(30),
      }),
    }),
  ))

  await expect(
    runMockedRateLimit(consumeChatRateLimit(principal("organization-1", "tenant-user-1"))),
  ).resolves.toBe(true)
})

function principal(organizationId: string, tenantUserId: string) {
  return {
    organization: { id: organizationId },
    tenantUser: { id: tenantUserId },
  }
}

function rateLimitKey(value: unknown): string {
  if (!value || typeof value !== "object" || !("key" in value) || typeof value.key !== "string") {
    throw new TypeError("Expected rate-limit options")
  }
  return value.key
}

function runMockedRateLimit<Value, Error, Requirements>(
  effect: Effect.Effect<Value, Error, Requirements>,
): Promise<Value> {
  // The mocked databaseRateLimiter returns an environment-free Effect at runtime.
  return Effect.runPromise(effect as Effect.Effect<Value, Error>)
}
