// Adapted with: deno task ui add @emailcn/react-email/block-notification-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/blocks/notification-default.tsx
// Local changes: Repurpose the notification block as an organization deletion notice, use the shared shell and dashboard URL, and co-locate typed preview props.

import { Heading, Section, Text } from "react-email"

import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { EmailAction, EmailDivider, EmailShell } from "../email-shell.tsx"

interface OrganizationDeletedEmailProps {
  appName: string
  dashboardURL: string
  logoURL: string
  organizationName: string
  timestamp: string
}

export default function OrganizationDeletedEmail({
  appName,
  dashboardURL,
  logoURL,
  organizationName,
  timestamp,
}: OrganizationDeletedEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview={`${organizationName} was deleted`}>
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        Organization deleted
      </Heading>
      <Text className="m-0 text-base leading-6 text-foreground">
        The {appName} organization <strong>{organizationName}</strong>, which you owned, has been
        deleted. Its members, API keys, agents, sandbox providers, tenants, and tenant users have
        been removed.
      </Text>

      <Section className="my-8 rounded-brand border border-solid border-border bg-muted px-5 py-4">
        <Text className="m-0 mb-2 text-xs leading-5 text-foreground">Deleted at:</Text>
        <Text className="m-0 text-sm font-medium leading-5 text-foreground">{timestamp}</Text>
      </Section>

      <Text className="m-0 text-base leading-6 text-foreground">
        Embedded chat and API calls that used its keys no longer work. Deletion cannot be undone.
      </Text>

      <EmailAction href={dashboardURL} label="Open dashboard" />

      <EmailDivider />
      <Text className="m-0 text-sm leading-6 text-muted-foreground">
        Email sent by {appName} to the organization&apos;s owners.
      </Text>
    </EmailShell>
  )
}

export function createOrganizationDeletedPreviewProps(
  origin: string,
): OrganizationDeletedEmailProps {
  return {
    appName: APP_NAME,
    dashboardURL: new URL("/", INERT_REDIRECT_ORIGIN).href,
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    organizationName: "Acme Inc",
    timestamp: "September 29, 2026 at 10:00:00 AM UTC",
  } satisfies OrganizationDeletedEmailProps
}
