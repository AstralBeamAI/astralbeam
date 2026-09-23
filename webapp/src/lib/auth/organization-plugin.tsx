// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor and drop the organizations settings tab, which lives at /organizations, and drop the redundant `localization` assertion.

import { createAuthPlugin } from "@better-auth-ui/core"
import {
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
      views: {
        auth: { acceptInvitation: AcceptInvitation },
      },
    }
  },
)
