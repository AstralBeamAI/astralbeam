// App-owned composition based on shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06 React Email blocks.
// Local changes: Compose one branded, light-only shell and fallback action for all auth emails.

import type { ReactNode } from "react"
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email"

import { truncateEmailGraphemes } from "./email-text.ts"
import { emailTailwindConfig } from "./email-theme.ts"

const EMAIL_PREVIEW_CHARACTER_LIMIT = 90

export interface EmailShellProps {
  appName: string
  children: ReactNode
  /** An absolute URL for the light-baseline brand mark. */
  logoURL: string
  preview: string
}

export function EmailShell({ appName, children, logoURL, preview }: EmailShellProps) {
  const emailPreview = truncateEmailPreviewText(preview)

  return (
    <Html lang="en">
      <Tailwind config={emailTailwindConfig}>
        <Head />
        <Body className="m-0 bg-background px-4 py-8 font-sans text-foreground">
          <Preview>{emailPreview}</Preview>
          <Container className="mx-auto w-full max-w-email overflow-hidden rounded-brand border border-solid border-border bg-card">
            <Section className="p-8">
              <Img
                alt={`${appName} logo`}
                className="mb-10 block"
                height="48"
                src={logoURL}
                width="48"
              />
              {children}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

function truncateEmailPreviewText(value: string): string {
  const normalized = value.trim()
  const truncated = truncateEmailGraphemes(normalized, EMAIL_PREVIEW_CHARACTER_LIMIT)
  if (truncated === normalized) return normalized
  return `${truncateEmailGraphemes(normalized, EMAIL_PREVIEW_CHARACTER_LIMIT - 1).trimEnd()}…`
}

export interface EmailAddressLinkProps {
  email: string
}

export function EmailAddressLink({ email }: EmailAddressLinkProps) {
  return (
    <Link className="break-all font-medium text-primary underline" href={`mailto:${email}`}>
      {email}
    </Link>
  )
}

export function EmailDivider() {
  return <Hr className="my-8 w-full border-0 border-t border-solid border-t-border" />
}

export interface EmailActionProps {
  href: string
  label: string
}

export function EmailAction({ href, label }: EmailActionProps) {
  return (
    <>
      <Section className="my-8">
        <Button
          className="box-border inline-block rounded-brand bg-primary px-6 py-3 text-sm font-medium text-primary-foreground no-underline"
          href={href}
        >
          {label}
        </Button>
      </Section>
      <Text className="m-0 mb-2 text-xs leading-5 text-muted-foreground">
        Or copy and paste this URL into your browser:
      </Text>
      <Link className="break-all text-xs leading-5 text-primary underline" href={href}>
        {href}
      </Link>
    </>
  )
}
