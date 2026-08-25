import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email"

import { APP_LOGO_DARK_PNG_URL, APP_LOGO_LIGHT_PNG_URL, APP_NAME } from "../../lib/constants.ts"
import { EmailStyles, emailTailwindConfig } from "../email-styles.tsx"

interface EmailVerificationEmailProps {
  appName: string
  logoURL: { light: string; dark: string }
  verificationUrl: string
  email: string
  expiryMinutes: number
}

export default function EmailVerificationEmail({
  appName,
  logoURL,
  verificationUrl,
  email,
  expiryMinutes,
}: EmailVerificationEmailProps) {
  return (
    <Html>
      <Head>
        <meta content="light dark" name="color-scheme" />
        <meta content="light dark" name="supported-color-schemes" />
        <EmailStyles />
      </Head>

      <Preview>Verify your email on {appName}</Preview>

      <Tailwind config={emailTailwindConfig}>
        <Body className="email-bg-background email-text-foreground bg-background font-sans text-foreground">
          <Container className="mx-auto my-auto max-w-xl px-2 py-10">
            <Section className="email-bg-card email-border-border email-text-card-foreground rounded-none border border-border bg-card p-8 text-card-foreground">
              <Img
                src={logoURL.light}
                width={48}
                height={48}
                alt={`${appName} logo`}
                className="logo-light mx-auto mb-8"
              />
              <Img
                src={logoURL.dark}
                width={48}
                height={48}
                alt={`${appName} logo`}
                className="logo-dark mx-auto mb-8 hidden"
              />

              <Heading className="m-0 mb-5 font-heading text-2xl font-semibold">
                Verify your email on {appName}
              </Heading>

              <Text className="text-sm">
                Click the button below to verify your email and finish setting up your account.
              </Text>

              <Section className="my-6">
                <Button
                  href={verificationUrl}
                  className="email-bg-primary email-text-primary-foreground inline-block whitespace-nowrap rounded-none bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground no-underline"
                >
                  Verify email
                </Button>
              </Section>

              <Text className="email-text-muted-foreground m-0 mb-3 text-xs text-muted-foreground">
                Or copy and paste this URL into your browser:
              </Text>
              <Link
                href={verificationUrl}
                className="email-text-primary break-all text-xs text-primary no-underline"
              >
                {verificationUrl}
              </Link>

              <Hr className="email-border-border my-6 w-full border border-solid border-border" />

              <Text className="email-text-muted-foreground m-0 text-xs leading-normal text-muted-foreground">
                This link was sent to{" "}
                <span className="font-semibold">{email}</span>. If you did not request it, you can
                safely ignore this email. The link will expire in {expiryMinutes} minutes.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

EmailVerificationEmail.PreviewProps = {
  appName: APP_NAME,
  verificationUrl: "https://example.com/api/auth/verify-email?token=sdfsfsdfsfsdf",
  email: "test@example.com",
  logoURL: {
    light: new URL(APP_LOGO_LIGHT_PNG_URL, "http://localhost:3000").href,
    dark: new URL(APP_LOGO_DARK_PNG_URL, "http://localhost:3000").href,
  },
  expiryMinutes: 10,
} satisfies EmailVerificationEmailProps
