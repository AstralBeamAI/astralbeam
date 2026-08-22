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
  pixelBasedPreset,
  Preview,
  Section,
  Tailwind,
  Text,
} from "react-email"

const APP_NAME = "AstralBeam"

interface EmailVerificationEmailProps {
  logoUrl: string
  verificationUrl: string
  email: string
  expiryMinutes: number
}

export default function EmailVerificationEmail({
  logoUrl,
  verificationUrl,
  email,
  expiryMinutes,
}: EmailVerificationEmailProps) {
  return (
    <Html>
      <Head />
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
        }}
      >
        <Body className="bg-white font-sans text-gray-900">
          <Preview>Verify your email on {APP_NAME}</Preview>
          <Container className="px-4">
            <Section className="w-md max-w-md border border-gray-200 my-8 p-4">
              <Img
                src={logoUrl}
                width="48"
                height="48"
                alt={`${APP_NAME} logo`}
                className="mx-auto block my-6 object-contain"
              />

              <Heading className="text-2xl text-center font-normal my-6">
                {"Verify your email on "}
                <span className="font-bold">{APP_NAME}</span>
              </Heading>

              <Text className="text-sm my-6">
                Click the button below to verify your email and finish setting up your account:
              </Text>

              <Section className="text-center my-6">
                <Button
                  href={verificationUrl}
                  className="bg-black text-white text-sm font-semibold px-6 py-3 rounded"
                >
                  Verify email
                </Button>
              </Section>

              <Section className="my-6">
                <Text className="text-xs m-0">or copy and paste this URL into your browser:</Text>
                <Link href={verificationUrl} className="text-blue-600 no-underline text-xs m-0">
                  {verificationUrl}
                </Link>
              </Section>

              <Hr />

              <Text className="text-xs my-6 text-gray-600 leading-normal">
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
  verificationUrl: "https://example.com/api/auth/verify-email?token=sdfsfsdfsfsdf",
  email: "test@example.com",
  logoUrl: "http://localhost:3000/astralbeam-logo-light.png",
  expiryMinutes: 10,
} satisfies EmailVerificationEmailProps
