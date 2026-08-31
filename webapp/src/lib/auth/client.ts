import { apiKeyClient } from "@better-auth/api-key/client"
import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"

import { organizationAccessControl, organizationRoles } from "@/lib/auth/organization-access"

export const authClient = createAuthClient({
  plugins: [
    organizationClient({
      ac: organizationAccessControl,
      roles: organizationRoles,
    }),
    apiKeyClient(),
  ],
})
