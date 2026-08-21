import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/organization/access"

export type OrganizationRole = "admin" | "member" | "owner"

function getOrganizationRoles(role: string) {
  return role.split(",").map((value) => value.trim()).filter(Boolean)
}

export function hasOrganizationRole(role: string, expected: OrganizationRole) {
  return getOrganizationRoles(role).includes(expected)
}

export function isSoleOrganizationOwner(
  members: ReadonlyArray<{ role: string; userId: string }>,
  userId: string | undefined,
) {
  if (!userId) return false

  const owners = members.filter((member) => hasOrganizationRole(member.role, "owner"))
  return owners.length === 1 && owners[0]?.userId === userId
}

export function assertCanAssignOrganizationAccessRole(
  actorRole: string,
  requestedRole: Exclude<OrganizationRole, "owner">,
) {
  const isOwner = hasOrganizationRole(actorRole, "owner")
  const isAdmin = hasOrganizationRole(actorRole, "admin")

  if (!isOwner && !isAdmin) {
    throw new Error("Only organization owners and admins can manage access")
  }
  if (requestedRole === "admin" && !isOwner) {
    throw new Error("Only organization owners can grant admin access")
  }
}

export function assertCanUpdateOrganizationAccessRole(
  actorRole: string,
  currentRole: string,
  requestedRole: Exclude<OrganizationRole, "owner">,
) {
  assertCanAssignOrganizationAccessRole(actorRole, requestedRole)

  if (hasOrganizationRole(currentRole, "owner")) {
    throw new Error("Organization owner roles must be changed from member settings")
  }
  if (
    hasOrganizationRole(currentRole, "admin") &&
    !hasOrganizationRole(actorRole, "owner")
  ) {
    throw new Error("Only organization owners can change admin access")
  }
}

export const organizationAccessControl = createAccessControl(defaultStatements)

export const organizationRoles = {
  owner: organizationAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
  admin: organizationAccessControl.newRole({
    organization: ["update"],
    member: ["create"],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
  member: organizationAccessControl.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
} as const
