// Previously added with: deno task ui add @better-auth-ui/reset-password-email
// Adapted with: deno task ui add @emailcn/react-email/block-auth-password-reset-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/blocks/auth-password-reset-default.tsx
// Local changes: Retain the prior reset copy and required production props, use the shared shell and fallback URL, and co-locate typed preview props.

import { Heading, Text } from "react-email"

import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

interface ResetPasswordEmailProps {
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

export function createResetPasswordPreviewProps(origin: string): ResetPasswordEmailProps {
  return {
    appName: APP_NAME,
    email: "member@example.com",
    expirationMinutes: 60,
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    url: new URL(
      "/api/auth/reset-password/preview-reset-token?callbackURL=%2Fauth%2Freset-password",
      INERT_REDIRECT_ORIGIN,
    ).href,
  } satisfies ResetPasswordEmailProps
}
