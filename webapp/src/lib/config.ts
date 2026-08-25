import { Schema } from "effect"

export const APP_NAME = "AstralBeam"
export const APP_HANDLE = "astralbeam"
const APP_WEBSITE = `https://www.${APP_HANDLE}.ai`
export const APP_LOGO_LIGHT_PNG_URL = "/astralbeam-logo-light.png"
export const APP_LOGO_DARK_PNG_URL = "/astralbeam-logo-dark.png"
export const APP_LOGO_LIGHT_SVG_URL = "/astralbeam-logo-light.svg"
export const APP_LOGO_DARK_SVG_URL = "/astralbeam-logo-dark.svg"
export const INERT_REDIRECT_ORIGIN = `https://${APP_HANDLE}.invalid`

const DEFAULT_PRIVACY_POLICY_URL = `${APP_WEBSITE}/privacy`
const DEFAULT_TERMS_OF_SERVICE_URL = `${APP_WEBSITE}/terms`
const decodePublicHttpUrl = Schema.decodeUnknownSync(
  Schema.URLFromString.pipe(
    Schema.check(
      Schema.makeFilter((url) => url.protocol === "https:" || url.protocol === "http:"),
    ),
  ),
)

function publicHttpUrl(value: string | undefined, fallback: string): string {
  try {
    return decodePublicHttpUrl(value || fallback).href
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new Error("Public legal URLs must use HTTP(S)")
  }
}

export const PRIVACY_POLICY_URL = publicHttpUrl(
  import.meta.env.VITE_PRIVACY_POLICY_URL,
  DEFAULT_PRIVACY_POLICY_URL,
)

export const TERMS_OF_SERVICE_URL = publicHttpUrl(
  import.meta.env.VITE_TERMS_OF_SERVICE_URL,
  DEFAULT_TERMS_OF_SERVICE_URL,
)
