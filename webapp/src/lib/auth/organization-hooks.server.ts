import { APIError } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"

import { organizationRoles } from "./organization-access.ts"

function assertConfiguredOrganizationRoles(role: string): void {
  const roles = role.split(",")
  if (
    roles.some((value) =>
      value.length === 0 || value !== value.trim() || !Object.hasOwn(organizationRoles, value)
    ) || new Set(roles).size !== roles.length
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_ORGANIZATION_ROLE",
      message: "Organization role is not supported",
    })
  }
}

export const organizationRoleHooks = {
  beforeAddMember: ({ member }) => {
    assertConfiguredOrganizationRoles(member.role)
    return Promise.resolve()
  },
  beforeUpdateMemberRole: ({ newRole }) => {
    assertConfiguredOrganizationRoles(newRole)
    return Promise.resolve()
  },
  beforeCreateInvitation: ({ invitation }) => {
    assertConfiguredOrganizationRoles(invitation.role)
    return Promise.resolve()
  },
  beforeAcceptInvitation: ({ invitation }) => {
    assertConfiguredOrganizationRoles(invitation.role)
    return Promise.resolve()
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>
