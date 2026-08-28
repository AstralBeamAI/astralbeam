// Adapted with: deno task ui add @emailcn/react-email/block-invite-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06
// Local changes: Preserve organization invitation copy and props, use the shared light brand shell, and retain the raw acceptance URL.

import { Heading, Text } from "react-email"

import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

export interface OrganizationInvitationEmailProps {
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
