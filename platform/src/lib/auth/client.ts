import { apiKeyClient } from "@better-auth/api-key/client"
import { createAuthClient } from "better-auth/react"
import { lastLoginMethodClient, organizationClient } from "better-auth/client/plugins"

import { organizationAccessControl, organizationRoles } from "@/lib/organizations/access"

export const authClient = createAuthClient({
  plugins: [
    lastLoginMethodClient(),
    organizationClient({
      ac: organizationAccessControl,
      roles: organizationRoles,
    }),
    apiKeyClient(),
  ],
})
