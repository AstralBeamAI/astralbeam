import { memoryAdapter } from "better-auth/adapters/memory"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { betterAuth } from "better-auth/minimal"
import { expect, test, vi } from "vitest"

import { assertResetPasswordSafe } from "./password-reset.server"

async function passwordReset(checkPassword: (password: string) => Promise<boolean>) {
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  }
  const auth = betterAuth({
    baseURL: "http://localhost:4500",
    secret: crypto.randomUUID() + crypto.randomUUID(),
    database: memoryAdapter(database),
    logger: { disabled: true },
    verification: { storeIdentifier: "hashed" },
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/reset-password") {
          await assertResetPasswordSafe(context, checkPassword)
        }
      }),
    },
  })
  const context = await auth.$context
  const user = await context.internalAdapter.createUser(
    { name: "Owner", email: "owner@example.test", emailVerified: true },
    { method: "admin" },
  )
  const token = crypto.randomUUID()
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  })
  return {
    database,
    reset: () =>
      auth.handler(
        new Request("http://localhost:4500/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost:4500" },
          body: JSON.stringify({ token, newPassword: "a-fresh-password-for-this-test" }),
        }),
      ),
  }
}

test.each(["compromised", "unavailable"])(
  "retains the reset link when the password check is %s, then consumes it on success",
  async (failure) => {
    const checkPassword = vi.fn<(password: string) => Promise<boolean>>()
    if (failure === "compromised") checkPassword.mockResolvedValueOnce(true)
    else {
      checkPassword.mockRejectedValueOnce(
        new APIError("INTERNAL_SERVER_ERROR", { message: "Password check unavailable" }),
      )
    }
    checkPassword.mockResolvedValue(false)
    const { database, reset } = await passwordReset(checkPassword)

    const rejected = await reset()
    expect(rejected.status).toBe(failure === "compromised" ? 400 : 500)
    expect(await rejected.json()).toMatchObject(
      failure === "compromised"
        ? { code: "PASSWORD_COMPROMISED" }
        : { message: "Password check unavailable" },
    )
    expect(database.verification).toHaveLength(1)
    expect(database.account).toHaveLength(0)

    expect((await reset()).status).toBe(200)
    expect(database.verification).toHaveLength(0)
    expect(database.account).toHaveLength(1)

    const replay = await reset()
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ code: "INVALID_TOKEN" })
    expect(checkPassword).toHaveBeenCalledTimes(2)
  },
)

test("only one concurrent reset can consume the link", async () => {
  const { database, reset } = await passwordReset(() => Promise.resolve(false))
  const responses = await Promise.all([reset(), reset()])
  expect(responses.map((response) => response.status).toSorted((a, b) => a - b)).toEqual([200, 400])
  expect(database.account).toHaveLength(1)
  expect(database.verification).toHaveLength(0)
})
