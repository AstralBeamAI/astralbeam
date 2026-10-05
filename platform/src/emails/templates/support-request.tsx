// Adapted with: deno task ui add @emailcn/react-email/block-notification-default
// Source: shadcn-labs/emailcn@7979f3be5fb0e7f689b810a24d48c2c75c40ed06:registry/bases/react-email/blocks/notification-default.tsx
// Local changes: Repurpose the notification block as a support request receipt that quotes the message, lists attachments and context, uses the shared shell, and co-locates typed preview props.

import { Heading, Section, Text } from "react-email"

import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { EmailAddressLink, EmailDivider, EmailShell } from "../email-shell.tsx"

interface SupportRequestEmailProps {
  appName: string
  attachmentNames: string[]
  email: string
  logoURL: string
  message: string
  name: string
  /** The dashboard page the request was sent from. */
  pageURL?: string | undefined
}

export default function SupportRequestEmail({
  appName,
  attachmentNames,
  email,
  logoURL,
  message,
  name,
  pageURL,
}: SupportRequestEmailProps) {
  return (
    <EmailShell appName={appName} logoURL={logoURL} preview="We received your support request">
      <Heading className="m-0 mb-6 text-xl font-medium leading-6 text-foreground">
        We received your request
      </Heading>
      <Text className="m-0 mb-4 text-base leading-6 text-foreground">Hi {name},</Text>
      <Text className="m-0 text-base leading-6 text-foreground">
        Thanks for contacting {appName} support. Our team is copied on this email and will reply
        here. Reply to this email to add more details.
      </Text>

      <Section className="my-8 rounded-brand border border-solid border-border bg-muted px-5 py-4">
        <Text className="m-0 mb-2 text-xs leading-5 text-foreground">Your message:</Text>
        <Text className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
          {message}
        </Text>
        {attachmentNames.length > 0 && (
          <>
            <Text className="m-0 mb-2 mt-4 text-xs leading-5 text-foreground">
              Attachments ({attachmentNames.length}):
            </Text>
            {attachmentNames.map((attachmentName, index) => (
              <Text
                key={`${index.toString()}-${attachmentName}`}
                className="m-0 break-all text-sm font-medium leading-6 text-foreground"
              >
                {attachmentName}
              </Text>
            ))}
          </>
        )}
      </Section>

      <EmailDivider />
      <Text className="m-0 mb-2 text-sm leading-6 text-muted-foreground">
        Account: <EmailAddressLink email={email} />
      </Text>
      {pageURL && (
        <Text className="m-0 break-all text-sm leading-6 text-muted-foreground">
          Sent from:{" "}
          <a className="text-primary underline" href={pageURL}>
            {pageURL}
          </a>
        </Text>
      )}
    </EmailShell>
  )
}

export function createSupportRequestPreviewProps(origin: string): SupportRequestEmailProps {
  return {
    appName: APP_NAME,
    attachmentNames: ["chat-error.png", "browser-console.txt"],
    email: "member@example.com",
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    message:
      "The agent sidebar stops responding after I switch tenants.\n\nSteps: open the chat, switch tenant, send a message. The screenshot shows the error.",
    name: "Alex Morgan",
    pageURL: new URL("/acme/agents", INERT_REDIRECT_ORIGIN).href,
  } satisfies SupportRequestEmailProps
}
