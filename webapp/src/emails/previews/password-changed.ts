import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import type { PasswordChangedEmailProps } from "../templates/password-changed.tsx"

export default function createPasswordChangedPreviewProps(
  origin: string,
): PasswordChangedEmailProps {
  return {
    appName: APP_NAME,
    email: "member@example.com",
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    recoverAccountURL: new URL("/auth/forgot-password", INERT_REDIRECT_ORIGIN).href,
    timestamp: "August 27, 2026 at 10:00:00 AM UTC",
  } satisfies PasswordChangedEmailProps
}
