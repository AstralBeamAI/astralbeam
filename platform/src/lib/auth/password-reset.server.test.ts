import { createHash } from "node:crypto"
import type { BetterAuthOptions } from "better-auth"
import { Effect, Layer } from "effect"
import { afterEach, expect, test, vi } from "vitest"

import { Config, type ConfigSnapshot } from "@/lib/config/config.server"
import { Mailer } from "@/lib/email/email.server"
import { Auth } from "./auth.server"

const database = vi.hoisted<Record<string, Record<string, unknown>[]>>(() => ({
  user: [],
  account: [],
  session: [],
  verification: [],
  rateLimit: [],
}))

vi.mock("better-auth/minimal", async (original) => {
  const { betterAuth } = await original<typeof import("better-auth/minimal")>()
  const { memoryAdapter } = await import("better-auth/adapters/memory")
  return {
    betterAuth: (options: BetterAuthOptions) =>
      betterAuth({
        ...options,
        database: memoryAdapter(database),
        advanced: { ...options.advanced, database: { generateId: "uuid" } },
      }),
  }
})
vi.mock(import("@/db/database.server"), async (original) => ({
  ...(await original()),
  getAuthDatabase: vi.fn(),
}))
vi.mock(import("@/lib/runtime/app-effect.server"), async (original) => ({
  ...(await original()),
  forkAppEffect: vi.fn(),
}))
vi.mock(import("@/lib/runtime/environment.server"), async (original) => ({
  ...(await original()),
  IS_TEST_RUNTIME: false,
}))

afterEach(() => vi.restoreAllMocks())

async function passwordReset() {
  for (const model of Object.keys(database)) database[model] = []
  const password = "a-fresh-password-for-this-test"
  const suffix = createHash("sha1").update(password).digest("hex").slice(5).toUpperCase()
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(new Response("00000000000000000000000000000000000:0")),
    )
  const auth = await Effect.runPromise(
    Effect.flatMap(Auth, (auth) => auth.instance).pipe(
      Effect.provide(Auth.layerNoDeps),
      Effect.provide([
        Layer.mock(Config, {
          snapshot: Effect.succeed<ConfigSnapshot>({
            generation: 0,
            rows: [],
            values: {
              app_base_url: "http://localhost:4500",
              better_auth_secret: crypto.randomUUID() + crypto.randomUUID(),
              turnstile_secret_key: "test-secret",
            },
            issues: [],
            environmentKeys: new Set(),
          }),
        }),
        Layer.mock(Mailer, { sendPasswordChanged: () => Effect.void }),
      ]),
    ),
  )
  const context = await auth.$context
  const userId = crypto.randomUUID()
  database.user!.push({
    id: userId,
    name: "Owner",
    email: "owner@example.test",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const token = crypto.randomUUID()
  await context.internalAdapter.createVerificationValue({
    id: crypto.randomUUID(),
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + 60_000),
  })
  return {
    fetch,
    suffix,
    reset: (newPassword = password) =>
      auth.handler(
        new Request("http://localhost:4500/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost:4500" },
          body: JSON.stringify({ token, newPassword }),
        }),
      ),
  }
}

test.each(["compromised", "unavailable"])(
  "retains the reset link when the password check is %s, then consumes it on success",
  async (failure) => {
    const { fetch, suffix, reset } = await passwordReset()
    fetch.mockResolvedValueOnce(
      failure === "compromised" ? new Response(`${suffix}:1`) : new Response(null, { status: 503 }),
    )

    const rejected = await reset()
    expect(rejected.status).toBe(failure === "compromised" ? 400 : 500)
    expect(await rejected.json()).toMatchObject(
      failure === "compromised"
        ? { code: "PASSWORD_COMPROMISED" }
        : { message: "Failed to check password. Status: 503" },
    )
    expect(database.verification).toHaveLength(1)
    expect(database.account).toHaveLength(0)

    expect((await reset("a-different-safe-password-for-this-test")).status).toBe(200)
    expect(database.verification).toHaveLength(0)
    expect(database.account).toHaveLength(1)

    const replay = await reset()
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ code: "INVALID_TOKEN" })
    expect(fetch).toHaveBeenCalledTimes(3)
  },
)

test("only one concurrent reset can consume the link", async () => {
  const { reset } = await passwordReset()
  const responses = await Promise.all([reset(), reset()])
  expect(responses.map((response) => response.status).toSorted((a, b) => a - b)).toEqual([200, 400])
  expect(database.account).toHaveLength(1)
  expect(database.verification).toHaveLength(0)
})
