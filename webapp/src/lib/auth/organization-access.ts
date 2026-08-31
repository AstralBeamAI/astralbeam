import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access"

const organizationApiKeyActions = ["create", "read", "update", "delete"] as const

// Extend the default statements and rebuild each role as documented for custom permissions. https://better-auth.com/docs/plugins/organization#custom-permissions
export const organizationAccessControl = createAccessControl({
  ...defaultStatements,
  apiKey: organizationApiKeyActions,
})

export const organizationRoles = {
  owner: organizationAccessControl.newRole({
    ...ownerAc.statements,
    apiKey: organizationApiKeyActions,
  }),
  developer: organizationAccessControl.newRole({
    ...memberAc.statements,
    apiKey: organizationApiKeyActions,
  }),
  viewer: organizationAccessControl.newRole({
    ...memberAc.statements,
  }),
} as const
