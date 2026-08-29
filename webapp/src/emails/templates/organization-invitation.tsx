// Previously added with: deno task ui add @better-auth-ui/organization-invitation-email
// Adapted with: deno task ui add @emailcn/react-email/block-invite-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/blocks/invite-default.tsx
// Local changes: Map the team invite to Better Auth organization, role, and inviter details; retain required production props; use the shared shell and fallback URL; and co-locate typed preview props.

import { Heading, Text } from "react-email"

import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

interface OrganizationInvitationEmailProps {
  appName: string
  expirationHours: number
  inviterEmail: string
  inviterName: string
  logoURL: string
  organizationName: string
  role: string
  url: string
}

export default function OrganizationInvitationEmail({
  appName,
  expirationHours,
  inviterEmail,
  inviterName,
  logoURL,
  organizationName,
  role,
  url,
}: OrganizationInvitationEmailProps) {
  return (
    <EmailShell
      appName={appName}
      logoURL={logoURL}
      preview={`You're invited to ${organizationName}`}
    >
      <Heading className="m-0 mb-6 break-words text-xl font-medium leading-6 text-foreground">
        You&apos;re invited to {organizationName}
      </Heading>
      <Text className="m-0 break-words text-base leading-6 text-foreground">
        <strong>{inviterName}</strong>{" "}
        (<EmailAddressLink email={inviterEmail} />) has invited you to join {organizationName} on
        {" "}
        {appName} with {role} access.
      </Text>

      <EmailAction href={url} label="Accept invitation" />

      <EmailDivider />
      <Text className="m-0 mb-3 text-sm leading-6 text-muted-foreground">
        This invitation expires in {expirationHours} hours. Email sent by {appName}.
      </Text>
      <Text className="m-0 text-sm leading-6 text-muted-foreground">
        If you didn&apos;t expect this invitation, you can safely ignore this email.
      </Text>
    </EmailShell>
  )
}

export function createOrganizationInvitationPreviewProps(
  origin: string,
): OrganizationInvitationEmailProps {
  return {
    appName: APP_NAME,
    expirationHours: 48,
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
