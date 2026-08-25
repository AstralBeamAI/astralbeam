import type { PublicConfig } from "@/lib/types"

export const APP_NAME = "AstralBeam"
export const APP_HANDLE = "astralbeam"
const APP_WEBSITE = `https://www.astralbeam.ai`
export const APP_LOGO_LIGHT_PNG_URL = "/astralbeam-logo-light.png"
export const APP_LOGO_DARK_PNG_URL = "/astralbeam-logo-dark.png"
export const APP_LOGO_LIGHT_SVG_URL = "/astralbeam-logo-light.svg"
export const APP_LOGO_DARK_SVG_URL = "/astralbeam-logo-dark.svg"
export const INERT_REDIRECT_ORIGIN = `https://${APP_HANDLE}.invalid`
export const AUTH_RETURN_PATHS = ["/auth/accept-invitation"] as const

// Fallbacks when the corresponding config values are unset; the operator can override both at /configure.
export const DEFAULT_PRIVACY_POLICY_URL = `${APP_WEBSITE}/privacy`
export const DEFAULT_TERMS_OF_SERVICE_URL = `${APP_WEBSITE}/terms`

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  enabledSocialProviders: [],
  privacyPolicyUrl: DEFAULT_PRIVACY_POLICY_URL,
  termsOfServiceUrl: DEFAULT_TERMS_OF_SERVICE_URL,
}
