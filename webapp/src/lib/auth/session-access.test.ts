import { describe, expect, test, vi } from "vitest"

import {
  type OrganizationMembershipIdentity,
  reconcileSessionAccess,
} from "@/lib/auth/session-access"

function dependencies(organizations: readonly OrganizationMembershipIdentity[]) {
  return {
    listOrganizations: vi.fn(() => Promise.resolve(organizations)),
    setActiveOrganization: vi.fn((_organizationId: string) => Promise.resolve()),
  }
}

describe("session organization access", () => {
  test("does not query memberships for a signed-out request", async () => {
    const api = dependencies([{ id: "organization-a" }])

    await expect(reconcileSessionAccess(null, api)).resolves.toEqual({
      status: "signed-out",
    })
    expect(api.listOrganizations).not.toHaveBeenCalled()
    expect(api.setActiveOrganization).not.toHaveBeenCalled()
  })

  test("requires onboarding only when the authenticated user has no memberships", async () => {
    const api = dependencies([])

    await expect(
      reconcileSessionAccess(
        { userId: "user-a", activeOrganizationId: null },
        api,
      ),
    ).resolves.toEqual({ status: "onboarding", userId: "user-a" })
    expect(api.listOrganizations).toHaveBeenCalledOnce()
    expect(api.setActiveOrganization).not.toHaveBeenCalled()
  })

  test("retains an active organization that is still a membership", async () => {
    const api = dependencies([
      { id: "organization-b" },
      { id: "organization-a" },
    ])

    await expect(
      reconcileSessionAccess(
        { userId: "user-a", activeOrganizationId: "organization-b" },
        api,
      ),
    ).resolves.toEqual({
      status: "ready",
      userId: "user-a",
      organizationId: "organization-b",
    })
    expect(api.setActiveOrganization).not.toHaveBeenCalled()
  })

  test.each([null, "removed-organization"])(
    "selects the deterministic first membership for active organization %j",
    async (activeOrganizationId) => {
      const api = dependencies([
        { id: "organization-c" },
        { id: "organization-a" },
        { id: "organization-b" },
      ])

      await expect(
        reconcileSessionAccess(
          { userId: "user-a", activeOrganizationId },
          api,
        ),
      ).resolves.toEqual({
        status: "ready",
        userId: "user-a",
        organizationId: "organization-a",
      })
      expect(api.listOrganizations).toHaveBeenCalledOnce()
      expect(api.setActiveOrganization).toHaveBeenCalledExactlyOnceWith(
        "organization-a",
      )
    },
  )

  test("does not report ready until active-organization persistence succeeds", async () => {
    const api = dependencies([{ id: "organization-a" }])
    api.setActiveOrganization.mockRejectedValueOnce(new Error("concurrent removal"))

    await expect(
      reconcileSessionAccess(
        { userId: "user-a", activeOrganizationId: null },
        api,
      ),
    ).rejects.toThrow("concurrent removal")
  })
})
