// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor and drop the organizations settings tab, which lives at /organizations.

import { createAuthPlugin } from "@better-auth-ui/core"
import {
  type OrganizationLocalization,
  organizationPlugin as coreOrganizationPlugin,
  type OrganizationPluginOptions,
} from "@better-auth-ui/core/plugins/organization"

import { AcceptInvitation } from "@/components/auth/organization/accept-invitation"

export const organizationPlugin = createAuthPlugin(
  coreOrganizationPlugin.id,
  (options: OrganizationPluginOptions = {}) => {
    const core = coreOrganizationPlugin(options)

    return {
      ...core,
      localization: core.localization as OrganizationLocalization,
      views: {
        auth: { acceptInvitation: AcceptInvitation },
      },
    }
  },
)
