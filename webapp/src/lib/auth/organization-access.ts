import { memberAc, ownerAc } from "better-auth/plugins/organization/access"

export const organizationRoles = {
  owner: ownerAc,
  developer: memberAc,
  viewer: memberAc,
} as const
