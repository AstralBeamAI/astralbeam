import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { AUTH_EMAIL_LINK_EXPIRY_MINUTES } from "../constants.ts"
import type { EmailVerificationEmailProps } from "../templates/email-verification.tsx"

export default function createEmailVerificationPreviewProps(
  origin: string,
): EmailVerificationEmailProps {
  return {
    appName: APP_NAME,
    email: "member@example.com",
    expiryMinutes: AUTH_EMAIL_LINK_EXPIRY_MINUTES,
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    verificationUrl: new URL(
      "/api/auth/verify-email?token=preview-verification-token&callbackURL=%2F",
      INERT_REDIRECT_ORIGIN,
    ).href,
  } satisfies EmailVerificationEmailProps
}
