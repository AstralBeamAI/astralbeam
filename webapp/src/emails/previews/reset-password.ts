import { APP_LOGO_LIGHT_PNG_URL, APP_NAME, INERT_REDIRECT_ORIGIN } from "../../lib/constants.ts"
import { AUTH_EMAIL_LINK_EXPIRY_MINUTES } from "../constants.ts"
import type { ResetPasswordEmailProps } from "../templates/reset-password.tsx"

export default function createResetPasswordPreviewProps(origin: string): ResetPasswordEmailProps {
  return {
    appName: APP_NAME,
    email: "member@example.com",
    expirationMinutes: AUTH_EMAIL_LINK_EXPIRY_MINUTES,
    logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, origin).href,
    url: new URL(
      "/api/auth/reset-password/preview-reset-token?callbackURL=%2Fauth%2Freset-password",
      INERT_REDIRECT_ORIGIN,
    ).href,
  } satisfies ResetPasswordEmailProps
}
