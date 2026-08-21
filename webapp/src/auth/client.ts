import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"

import { organizationAccessControl, organizationRoles } from "./organization-access-control"

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac: organizationAccessControl, roles: organizationRoles })],
})
