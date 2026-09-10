import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access"

const organizationApiKeyActions = ["create", "read", "update", "delete"] as const
const organizationConfigurationActions = ["read", "update", "test", "delete"] as const
const organizationTenantManagementActions = ["read", "write"] as const

// Extend the default statements and rebuild each role as documented for custom permissions. https://better-auth.com/docs/plugins/organization#custom-permissions
export const organizationAccessControl = createAccessControl({
  ...defaultStatements,
  apiKey: organizationApiKeyActions,
  organizationConfiguration: organizationConfigurationActions,
  tenantManagement: organizationTenantManagementActions,
})

export const organizationRoles = {
  owner: organizationAccessControl.newRole({
    ...ownerAc.statements,
    apiKey: organizationApiKeyActions,
    organizationConfiguration: organizationConfigurationActions,
    tenantManagement: organizationTenantManagementActions,
  }),
  developer: organizationAccessControl.newRole({
    ...memberAc.statements,
    apiKey: organizationApiKeyActions,
    organizationConfiguration: organizationConfigurationActions,
    tenantManagement: organizationTenantManagementActions,
  }),
  viewer: organizationAccessControl.newRole({
    ...memberAc.statements,
    tenantManagement: ["read"],
  }),
} as const

export type OrganizationPermissionRequest = Parameters<
  typeof organizationRoles.owner.authorize
>[0]

/** Every organization permission a page or its navigation entry depends on. */
export interface OrganizationPermissions {
  readonly updateOrganization: boolean
  readonly createInvitation: boolean
  readonly cancelInvitation: boolean
  readonly updateMember: boolean
  readonly deleteMember: boolean
  readonly createApiKey: boolean
  readonly readApiKey: boolean
  readonly updateApiKey: boolean
  readonly deleteApiKey: boolean
  readonly readConfiguration: boolean
  readonly updateConfiguration: boolean
  readonly testConfiguration: boolean
  readonly deleteConfiguration: boolean
}

/** Mirrors Better Auth's own `hasPermission`, which authorizes each comma-separated role in turn. */
export function authorizeOrganizationRole(
  role: string,
  permissions: OrganizationPermissionRequest,
): boolean {
  return role.split(",").some((value) =>
    Object.hasOwn(organizationRoles, value) &&
    organizationRoles[value as keyof typeof organizationRoles].authorize(permissions).success
  )
}

export function deriveOrganizationPermissions(role: string): OrganizationPermissions {
  const allows = (permissions: OrganizationPermissionRequest) =>
    authorizeOrganizationRole(role, permissions)
  return {
    updateOrganization: allows({ organization: ["update"] }),
    createInvitation: allows({ invitation: ["create"] }),
    cancelInvitation: allows({ invitation: ["cancel"] }),
    updateMember: allows({ member: ["update"] }),
    deleteMember: allows({ member: ["delete"] }),
    createApiKey: allows({ apiKey: ["create"] }),
    readApiKey: allows({ apiKey: ["read"] }),
    updateApiKey: allows({ apiKey: ["update"] }),
    deleteApiKey: allows({ apiKey: ["delete"] }),
    readConfiguration: allows({ organizationConfiguration: ["read"] }),
    updateConfiguration: allows({ organizationConfiguration: ["update"] }),
    testConfiguration: allows({ organizationConfiguration: ["test"] }),
    deleteConfiguration: allows({ organizationConfiguration: ["delete"] }),
  }
}
