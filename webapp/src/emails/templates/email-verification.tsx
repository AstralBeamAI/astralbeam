// Adapted with: deno task ui add @emailcn/react-email/block-auth-magic-link-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06
// Local changes: Preserve verification copy and props, use the shared light brand shell, and add an email-safe fallback action URL.

import { Heading, Text } from "react-email"

import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

export interface EmailVerificationEmailProps {
  appName: string
  email: string
  expiryMinutes: number
  logoURL: string
  verificationUrl: string
}

export default function EmailVerificationEmail({
  appName,
  email,
  expiryMinutes,
  logoURL,
  verificationUrl,
}: EmailVerificationEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview={`Verify your email on ${appName}`}>
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        Verify your email on {appName}
      </Heading>
      <Text className="m-0 text-base leading-6 text-foreground">
        Click the button below to verify your email and finish setting up your account.
      </Text>

      <EmailAction href={verificationUrl} label="Verify email" />

      <EmailDivider />
      <Text className="m-0 text-sm leading-6 text-muted-foreground">
        This link was sent to{" "}
        <EmailAddressLink email={email} />. If you did not request it, you can safely ignore this
        email. The link will expire in {expiryMinutes} minutes.
      </Text>
    </EmailShell>
  )
}
