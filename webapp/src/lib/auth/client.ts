import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"

import { organizationRoles } from "@/lib/auth/organization-access"

export const authClient = createAuthClient({
  plugins: [
    organizationClient({
      roles: organizationRoles,
    }),
  ],
})
