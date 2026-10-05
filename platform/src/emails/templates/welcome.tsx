// Adapted with: deno task ui add @emailcn/react-email/block-notification-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/blocks/notification-default.tsx
// Local changes: Repurpose the notification block as the post-signup welcome, invite replies when a support address is copied, use the shared shell and dashboard URL, and co-locate typed preview props.

import { Heading, Text } from "react-email"

import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

interface WelcomeEmailProps {
  appName: string
  dashboardURL: string
  logoURL: string
  name: string
  /** The copied support address, which the reader's replies reach. */
  supportEmail?: string | undefined
}

export default function WelcomeEmail({
  appName,
  dashboardURL,
  logoURL,
  name,
  supportEmail,
}: WelcomeEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview={`Welcome to ${appName}`}>
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        Welcome to {appName}
      </Heading>
      <Text className="m-0 mb-4 text-base leading-6 text-foreground">Hi {name},</Text>
      <Text className="m-0 text-base leading-6 text-foreground">
        Thanks for signing up for {appName}. Your account is ready, and the dashboard is the place
        to get started.
      </Text>

      <EmailAction href={dashboardURL} label="Open dashboard" />

      {supportEmail && (
        <>
          <EmailDivider />
          <Text className="m-0 text-sm leading-6 text-muted-foreground">
            Have a question or feedback? Reply to this email. It reaches our team at{" "}
            <EmailAddressLink email={supportEmail} />, and we read every message.
          </Text>
        </>
      )}
    </EmailShell>
  )
}

export function createWelcomePreviewProps(origin: string): WelcomeEmailProps {
  return {
    appName: APP_NAME,
    dashboardURL: new URL("/", INERT_REDIRECT_ORIGIN).href,
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    name: "Alex Morgan",
    supportEmail: "support@example.com",
  } satisfies WelcomeEmailProps
}
