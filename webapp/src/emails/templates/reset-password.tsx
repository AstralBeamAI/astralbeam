// Adapted with: deno task ui add @emailcn/react-email/block-auth-password-reset-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06
// Local changes: Preserve reset flow copy and props, use the shared light brand shell, and retain the raw reset URL.

import { Heading, Text } from "react-email"

import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

export interface ResetPasswordEmailProps {
  appName: string
  email: string
  expirationMinutes: number
  logoURL: string
  url: string
}

export default function ResetPasswordEmail({
  appName,
  email,
  expirationMinutes,
  logoURL,
  url,
}: ResetPasswordEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview="Reset your password">
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        Reset your password
      </Heading>
      <Text className="m-0 text-base leading-6 text-foreground">
        We received a request to reset the password for your {appName} account{" "}
        <EmailAddressLink email={email} />.
      </Text>

      <EmailAction href={url} label="Reset password" />

      <EmailDivider />
      <Text className="m-0 mb-3 text-sm leading-6 text-muted-foreground">
        This link expires in {expirationMinutes} minutes. Email sent by {appName}.
      </Text>
      <Text className="m-0 text-sm leading-6 text-muted-foreground">
        If you didn&apos;t request a password reset, you can safely ignore this email. Your password
        will remain unchanged.
      </Text>
    </EmailShell>
  )
}
