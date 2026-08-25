import { describe, expect, test } from "vitest"

import { acceptedAtForUserCreation } from "./legal.server.ts"

describe("legal acceptance for user creation", () => {
  test("accepts an explicit email-signup assertion and creates the timestamp on the server", async () => {
    const before = new Date()
    const acceptedAt = await acceptedAtForUserCreation({
      path: "/sign-up/email",
      body: { termsAccepted: true, termsAcceptedAt: "client-controlled" },
    })

    expect(acceptedAt).toBeInstanceOf(Date)
    expect(acceptedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  test.each([undefined, null, false, "true", 1])(
    "rejects an email signup assertion of %j",
    async (termsAccepted) => {
      await expect(
        acceptedAtForUserCreation({
          path: "/sign-up/email",
          body: { termsAccepted },
        }),
      ).rejects.toMatchObject({ body: { code: "legal_acceptance_required" } })
    },
  )

  test("requires the protected OAuth server context instead of client-authored state", async () => {
    await expect(
      acceptedAtForUserCreation(
        { path: "/callback/:id" },
        () =>
          Promise.resolve({
            requestSignUp: true,
            termsAccepted: true,
          }),
      ),
    ).rejects.toMatchObject({ body: { code: "legal_acceptance_required" } })
  })

  test("accepts the protected OAuth signup marker", async () => {
    await expect(
      acceptedAtForUserCreation(
        { path: "/callback/:id" },
        () =>
          Promise.resolve({
            requestSignUp: true,
            serverContext: { termsAccepted: true },
          }),
      ),
    ).resolves.toBeInstanceOf(Date)
  })

  test("rejects user creation outside supported signup endpoints", async () => {
    await expect(
      acceptedAtForUserCreation({ path: "/admin/create-user" }),
    ).rejects.toMatchObject({ body: { code: "legal_acceptance_required" } })
  })
})
