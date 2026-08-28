// Adapted with: deno task ui add @emailcn/react-email/block-notification-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06
// Local changes: Preserve password-change security copy, require production props, use the shared light brand shell, and expose the public recovery URL as text.

import { Heading, Section, Text } from "react-email"

import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

export interface PasswordChangedEmailProps {
  appName: string
  email: string
  logoURL: string
  recoverAccountURL: string
  timestamp: string
}

export default function PasswordChangedEmail({
  appName,
  email,
  logoURL,
  recoverAccountURL,
  timestamp,
}: PasswordChangedEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview="Your password has been changed">
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        Password changed successfully
      </Heading>
      <Text className="m-0 text-base leading-6 text-foreground">
        The password for your {appName} account <EmailAddressLink email={email} />{" "}
        has been changed successfully.
      </Text>

      <Section className="my-8 rounded-brand border border-solid border-border bg-muted px-5 py-4">
        <Text className="m-0 mb-2 text-xs leading-5 text-foreground">Changed at:</Text>
        <Text className="m-0 text-sm font-medium leading-5 text-foreground">{timestamp}</Text>
      </Section>

      <Text className="m-0 text-base leading-6 text-foreground">
        If you made this change, you can safely ignore this email. Your account is secure.
      </Text>

      <EmailAction href={recoverAccountURL} label="Reset password" />

      <EmailDivider />
      <Text className="m-0 mb-3 text-sm leading-6 text-muted-foreground">
        Email sent by {appName}.
      </Text>
      <Text className="m-0 text-sm leading-6 text-muted-foreground">
        If you didn&apos;t authorize this change, use the button above to reset your password
        immediately.
      </Text>
    </EmailShell>
  )
}
