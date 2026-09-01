// Adapted with: deno task ui add @emailcn/react-email/block-notification-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/blocks/notification-default.tsx
// Local changes: Repurpose the notification block as the duplicate-signup notice, use the shared shell with sign-in and recovery URLs, and co-locate typed preview props.

import { Heading, Text } from "react-email"

import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { EmailAction, EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

interface AccountExistsEmailProps {
  appName: string
  email: string
  logoURL: string
  recoverAccountURL: string
  signInURL: string
}

export default function AccountExistsEmail({
  appName,
  email,
  logoURL,
  recoverAccountURL,
  signInURL,
}: AccountExistsEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview="You already have an account">
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        You already have an account
      </Heading>
      <Text className="m-0 text-base leading-6 text-foreground">
        Someone just tried to sign up for {appName} with{" "}
        <EmailAddressLink email={email} />, but this address is already registered. Sign in instead
        of signing up again.
      </Text>

      <EmailAction href={signInURL} label="Sign in" />

      <EmailDivider />
      <Text className="m-0 mb-3 text-sm leading-6 text-muted-foreground">
        Forgot your password? Reset it at{" "}
        <a className="text-primary underline" href={recoverAccountURL}>
          {recoverAccountURL}
        </a>.
      </Text>
      <Text className="m-0 text-sm leading-6 text-muted-foreground">
        If this was not you, no action is needed: your password was not changed and no new account
        was created.
      </Text>
    </EmailShell>
  )
}

export function createAccountExistsPreviewProps(origin: string): AccountExistsEmailProps {
  return {
    appName: APP_NAME,
    email: "member@example.com",
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    recoverAccountURL: new URL("/auth/forgot-password", INERT_REDIRECT_ORIGIN).href,
    signInURL: new URL("/auth/sign-in", INERT_REDIRECT_ORIGIN).href,
  } satisfies AccountExistsEmailProps
}
