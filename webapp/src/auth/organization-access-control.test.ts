import { describe, expect, it } from "vitest"

import {
  assertCanAssignOrganizationAccessRole,
  assertCanUpdateOrganizationAccessRole,
  hasOrganizationRole,
  isSoleOrganizationOwner,
  organizationRoles,
} from "./organization-access-control"

describe("organization access control", () => {
  it("recognizes roles in a multiple-role membership", () => {
    expect(hasOrganizationRole("member, owner", "owner")).toBe(true)
    expect(hasOrganizationRole("member, owner", "admin")).toBe(false)
  })

  it("identifies only the organization's sole owner", () => {
    const members = [
      { role: "member,owner", userId: "owner-id" },
      { role: "member", userId: "member-id" },
    ]

    expect(isSoleOrganizationOwner(members, "owner-id")).toBe(true)
    expect(isSoleOrganizationOwner(members, "member-id")).toBe(false)
    expect(
      isSoleOrganizationOwner([...members, { role: "owner", userId: "second-owner" }], "owner-id"),
    )
      .toBe(false)
  })

  it("allows owners and admins to grant member access", () => {
    expect(() => assertCanAssignOrganizationAccessRole("owner", "member")).not.toThrow()
    expect(() => assertCanAssignOrganizationAccessRole("admin", "member")).not.toThrow()
  })

  it("allows only owners to grant admin access", () => {
    expect(() => assertCanAssignOrganizationAccessRole("owner", "admin")).not.toThrow()
    expect(() => assertCanAssignOrganizationAccessRole("admin", "admin")).toThrow(
      "Only organization owners can grant admin access",
    )
  })

  it("protects privileged members from access-role changes", () => {
    expect(() => assertCanUpdateOrganizationAccessRole("owner", "admin", "member")).not.toThrow()
    expect(() => assertCanUpdateOrganizationAccessRole("admin", "admin", "member")).toThrow(
      "Only organization owners can change admin access",
    )
    expect(() => assertCanUpdateOrganizationAccessRole("owner", "owner", "member")).toThrow(
      "Organization owner roles must be changed from member settings",
    )
  })

  it("keeps stock organization endpoints from bypassing owner-only role assignment", () => {
    expect(organizationRoles.owner.authorize({ member: ["update"] }).success).toBe(true)
    expect(organizationRoles.owner.authorize({ member: ["delete"] }).success).toBe(true)
    expect(organizationRoles.admin.authorize({ member: ["update"] }).success).toBe(false)
    expect(organizationRoles.admin.authorize({ member: ["delete"] }).success).toBe(false)
    expect(organizationRoles.admin.authorize({ invitation: ["create"] }).success).toBe(false)
  })
})
