import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { ORGANIZATION_INVITATION_EXPIRY_HOURS } from "../constants.ts"
import type { OrganizationInvitationEmailProps } from "../templates/organization-invitation.tsx"

export default function createOrganizationInvitationPreviewProps(
  origin: string,
): OrganizationInvitationEmailProps {
  return {
    appName: APP_NAME,
    expirationHours: ORGANIZATION_INVITATION_EXPIRY_HOURS,
    inviterEmail: "owner@example.com",
    inviterName: "Alex Morgan",
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    organizationName: "Example Organization",
    role: "viewer",
    url: new URL(
      "/auth/accept-invitation?invitationId=preview-invitation-id",
      INERT_REDIRECT_ORIGIN,
    ).href,
  } satisfies OrganizationInvitationEmailProps
}
