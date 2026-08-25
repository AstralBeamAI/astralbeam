import { createContext, useContext } from "react"
import { createServerFn } from "@tanstack/react-start"

export const APP_NAME = "AstralBeam"
export const APP_HANDLE = "astralbeam"
const APP_WEBSITE = `https://www.${APP_HANDLE}.ai`
export const APP_LOGO_LIGHT_PNG_URL = "/astralbeam-logo-light.png"
export const APP_LOGO_DARK_PNG_URL = "/astralbeam-logo-dark.png"
export const APP_LOGO_LIGHT_SVG_URL = "/astralbeam-logo-light.svg"
export const APP_LOGO_DARK_SVG_URL = "/astralbeam-logo-dark.svg"
export const INERT_REDIRECT_ORIGIN = `https://${APP_HANDLE}.invalid`

// Fallbacks when the corresponding config values are unset; the operator can override both at /configure.
export const DEFAULT_PRIVACY_POLICY_URL = `${APP_WEBSITE}/privacy`
export const DEFAULT_TERMS_OF_SERVICE_URL = `${APP_WEBSITE}/terms`

// The non-secret slice of the database-backed runtime configuration that the client may see.
export interface PublicConfig {
  enabledSocialProviders: ("google" | "github")[]
  privacyPolicyUrl: string
  termsOfServiceUrl: string
}

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  enabledSocialProviders: [],
  privacyPolicyUrl: DEFAULT_PRIVACY_POLICY_URL,
  termsOfServiceUrl: DEFAULT_TERMS_OF_SERVICE_URL,
}

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig> => {
    const { getPublicConfigSnapshot } = await import("@/lib/config.server")
    return getPublicConfigSnapshot()
  },
)

export const PublicConfigContext = createContext<PublicConfig>(DEFAULT_PUBLIC_CONFIG)

export function usePublicConfig(): PublicConfig {
  return useContext(PublicConfigContext)
}
