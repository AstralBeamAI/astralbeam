// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor and preserve the literal settings view for strict plugin inference.

import { createAuthPlugin } from "@better-auth-ui/core"
import {
  type OrganizationLocalization,
  organizationPlugin as coreOrganizationPlugin,
  type OrganizationPluginOptions,
} from "@better-auth-ui/core/plugins/organization"
import { BriefcaseIcon as Briefcase } from "@phosphor-icons/react"

import { AcceptInvitation } from "@/components/auth/organization/accept-invitation"
import { OrganizationsSettings } from "@/components/auth/organization/organizations-settings"

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
      settingsTabs: [
        {
          view: "organizations" as const,
          label: (
            <>
              <Briefcase className="text-muted-foreground" />
              {core.localization.organizations}
            </>
          ),
          component: OrganizationsSettings,
        },
      ],
    }
  },
)
