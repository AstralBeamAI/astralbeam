// Added with: deno task ui add @better-auth-ui/reset-password-email
// Local changes: Move into the email delivery domain, rewire local imports, apply the shared semantic shadcn email theme, and keep one default component export for directory-driven previews.

import type { ReactNode } from "react"
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

import { cn } from "../../lib/utils"
import {
  type EmailClassNames,
  type EmailColors,
  EmailStyles,
  emailTailwindConfig,
} from "../email-styles"

const resetPasswordEmailLocalization = {
  RESET_YOUR_PASSWORD: "Reset your password",
  LOGO: "Logo",
  WE_RECEIVED_REQUEST_TO_RESET_PASSWORD:
    "We received a request to reset the password for your {appName} account {email}.",
  RESET_PASSWORD: "Reset password",
  OR_COPY_AND_PASTE_URL: "Or copy and paste this URL into your browser:",
  THIS_LINK_EXPIRES_IN_MINUTES: "This link expires in {expirationMinutes} minutes.",
  EMAIL_SENT_BY: "Email sent by {appName}.",
  IF_YOU_DIDNT_REQUEST_PASSWORD_RESET:
    "If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.",
  POWERED_BY_BETTER_AUTH: "Powered by {betterAuth}",
}

/**
 * Localization strings for the ResetPasswordEmail component.
 *
 * Contains all text content used in the password reset email template.
 */
export type ResetPasswordEmailLocalization = typeof resetPasswordEmailLocalization

/**
 * Props for the ResetPasswordEmail component.
 */
export interface ResetPasswordEmailProps {
  /** Password reset URL that users must click to reset their password */
  url: string
  /** Email address of the user requesting password reset */
  email?: string
  /** Name of the application sending the email */
  appName?: string
  /** Number of minutes until the reset link expires */
  expirationMinutes?: number
  /** Logo URL(s) - a single string or light/dark variants. If omitted, no logo is shown. */
  logoURL?: string | { light: string; dark: string }
  /** Custom CSS class names for styling specific parts of the email */
  classNames?: EmailClassNames
  /** Custom color scheme for light and dark modes */
  colors?: EmailColors
  /** Whether to show the "Powered by better-auth" footer */
  poweredBy?: boolean
  /** Whether to enable dark mode support */
  darkMode?: boolean
  /** Additional React nodes to inject into the email head */
  head?: ReactNode
  /**
   * Localization overrides for customizing email text
   * @remarks `ResetPasswordEmailLocalization`
   */
  localization?: Partial<ResetPasswordEmailLocalization>
}

/**
 * Email template component that sends password reset links to users.
 *
 * This email includes:
 * - Password reset button and fallback URL
 * - Expiration time information
 * - Security notice for unauthorized requests
 * - Customizable branding and styling
 * - Support for light/dark mode themes
 *
 * @example
 * ```tsx
 * <ResetPasswordEmail
 *   url="https://example.com/auth/reset-password?token=abc123"
 *   email="user@example.com"
 *   appName="My App"
 *   expirationMinutes={60}
 *   logoURL="https://example.com/logo.png"
 *   darkMode={true}
 * />
 * ```
 */
const ResetPasswordEmail = ({
  url,
  email,
  appName,
  expirationMinutes = 60,
  logoURL,
  colors,
  classNames,
  darkMode = true,
  poweredBy,
  head,
  ...props
}: ResetPasswordEmailProps) => {
  const localization = {
    ...ResetPasswordEmail.localization,
    ...props.localization,
  }

  const previewText = localization.RESET_YOUR_PASSWORD

  return (
    <Html>
      <Head>
        <meta content="light dark" name="color-scheme" />
        <meta content="light dark" name="supported-color-schemes" />

        <EmailStyles colors={colors} darkMode={darkMode} />

        {head}
      </Head>

      <Preview>{previewText}</Preview>

      <Tailwind config={emailTailwindConfig}>
        <Body
          className={cn(
            "email-bg-background email-text-foreground bg-background font-sans text-foreground",
            classNames?.body,
          )}
        >
          <Container
            className={cn(
              "mx-auto my-auto max-w-xl px-2 py-10",
              classNames?.container,
            )}
          >
            <Section
              className={cn(
                "email-bg-card email-border-border email-text-card-foreground bg-card text-card-foreground rounded-none border border-border p-8",
                classNames?.card,
              )}
            >
              {logoURL &&
                (typeof logoURL === "string"
                  ? (
                    <Img
                      src={logoURL}
                      width={48}
                      height={48}
                      alt={appName || localization.LOGO}
                      className={cn("mx-auto mb-8", classNames?.logo)}
                    />
                  )
                  : (
                    <>
                      <Img
                        src={logoURL.light}
                        width={48}
                        height={48}
                        alt={appName || localization.LOGO}
                        className={cn(
                          "mx-auto mb-8 logo-light",
                          classNames?.logo,
                        )}
                      />
                      <Img
                        src={logoURL.dark}
                        width={48}
                        height={48}
                        alt={appName || localization.LOGO}
                        className={cn(
                          "hidden mx-auto mb-8 logo-dark",
                          classNames?.logo,
                        )}
                      />
                    </>
                  ))}

              <Heading
                className={cn(
                  "m-0 mb-5 font-heading text-2xl font-semibold",
                  classNames?.title,
                )}
              >
                {localization.RESET_YOUR_PASSWORD}
              </Heading>

              <Text className={cn("text-sm", classNames?.content)}>
                {(() => {
                  const textWithAppName = localization.WE_RECEIVED_REQUEST_TO_RESET_PASSWORD
                    .replace(
                      "{appName}",
                      appName || "",
                    )
                    .replace(/\s{2,}/g, " ")
                    .replace(" .", ".")

                  const [beforeEmail, afterEmail] = textWithAppName.split("{email}")

                  return email
                    ? (
                      <>
                        {beforeEmail}

                        <Link
                          href={`mailto:${email}`}
                          className="email-text-primary text-primary font-medium"
                        >
                          {email}
                        </Link>

                        {afterEmail}
                      </>
                    )
                    : (
                      textWithAppName
                        .replace("{email}", "")
                        .replace(/\s{2,}/g, " ")
                        .replace(" .", ".")
                    )
                })()}
              </Text>

              <Section className="my-6">
                <Button
                  href={url}
                  className={cn(
                    "email-bg-primary email-text-primary-foreground inline-block whitespace-nowrap rounded-none text-sm font-medium py-2.5 px-6 bg-primary text-primary-foreground no-underline",
                    classNames?.button,
                  )}
                >
                  {localization.RESET_PASSWORD}
                </Button>
              </Section>

              <Text
                className={cn(
                  "email-text-muted-foreground m-0 mb-3 text-xs text-muted-foreground",
                  classNames?.description,
                )}
              >
                {localization.OR_COPY_AND_PASTE_URL}
              </Text>

              <Link
                className={cn(
                  "email-text-primary break-all text-xs text-primary",
                  classNames?.link,
                )}
                href={url}
              >
                {url}
              </Link>

              <Hr
                className={cn(
                  "email-border-border my-6 w-full border border-solid border-border",
                  classNames?.separator,
                )}
              />

              {expirationMinutes || appName
                ? (
                  <Text
                    className={cn(
                      "email-text-muted-foreground m-0 mb-3 text-xs text-muted-foreground",
                      classNames?.description,
                    )}
                  >
                    {expirationMinutes
                      ? localization.THIS_LINK_EXPIRES_IN_MINUTES.replace(
                        "{expirationMinutes}",
                        expirationMinutes.toString(),
                      )
                      : null}

                    {appName && (
                      <>
                        {expirationMinutes ? " " : ""}
                        {localization.EMAIL_SENT_BY.replace("{appName}", appName)}
                      </>
                    )}
                  </Text>
                )
                : null}

              <Text
                className={cn(
                  "email-text-muted-foreground m-0 text-xs text-muted-foreground",
                  classNames?.description,
                )}
              >
                {localization.IF_YOU_DIDNT_REQUEST_PASSWORD_RESET}
              </Text>

              {poweredBy && (
                <Text
                  className={cn(
                    "email-text-muted-foreground m-0 mt-4 text-center text-[11px] text-muted-foreground",
                    classNames?.poweredBy,
                  )}
                >
                  {(() => {
                    const [beforeBetterAuth, afterBetterAuth] = localization.POWERED_BY_BETTER_AUTH
                      .split("{betterAuth}")

                    return (
                      <>
                        {beforeBetterAuth}
                        <Link
                          href="https://better-auth.com"
                          className={cn(
                            "email-text-primary text-primary underline",
                            classNames?.link,
                          )}
                        >
                          better-auth
                        </Link>
                        {afterBetterAuth}
                      </>
                    )
                  })()}
                </Text>
              )}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

ResetPasswordEmail.localization = resetPasswordEmailLocalization

ResetPasswordEmail.PreviewProps = {
  url: "https://better-auth-ui.com/auth/reset-password?token=example-token",
  email: "m@example.com",
  appName: "Better Auth",
  darkMode: true,
} as ResetPasswordEmailProps

export default ResetPasswordEmail
