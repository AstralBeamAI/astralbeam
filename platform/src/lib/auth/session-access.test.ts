import { describe, expect, test } from "vitest"

import { decideSessionAccess } from "@/lib/auth/session-access"

describe("session organization access", () => {
  test("requires onboarding only when the authenticated user has no memberships", () => {
    expect(decideSessionAccess(null, [])).toEqual({ status: "signed-out" })
    expect(decideSessionAccess({ userId: "user-a", activeOrganizationId: null }, [])).toEqual({
      status: "onboarding",
      userId: "user-a",
    })
  })

  test("retains an active organization that is still a membership", () => {
    expect(
      decideSessionAccess({ userId: "user-a", activeOrganizationId: "organization-b" }, [
        { id: "organization-b", slug: "organizationb" },
        { id: "organization-a", slug: "organizationa" },
      ]),
    ).toEqual({
      status: "ready",
      userId: "user-a",
      organizationId: "organization-b",
      organizationSlug: "organizationb",
    })
  })

  test.each([null, "removed-organization"])(
    "selects the deterministic first membership for active organization %j",
    (activeOrganizationId) => {
      expect(
        decideSessionAccess({ userId: "user-a", activeOrganizationId }, [
          { id: "organization-c", slug: "organizationc" },
          { id: "organization-a", slug: "organizationa" },
          { id: "organization-b", slug: "organizationb" },
        ]),
      ).toEqual({
        status: "ready",
        userId: "user-a",
        organizationId: "organization-a",
        organizationSlug: "organizationa",
      })
    },
  )
})
