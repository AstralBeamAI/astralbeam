import { describe, expect, it } from "vitest"

import { activatePendingOrganizationAccess } from "./organization-access.server"

describe("activatePendingOrganizationAccess", () => {
  it("does not consume email-based grants before the address is verified", async () => {
    const activated = await activatePendingOrganizationAccess(undefined as never, {
      email: "person@example.com",
      emailVerified: false,
      id: "user-id",
    })

    expect(activated).toBe(0)
  })
})
