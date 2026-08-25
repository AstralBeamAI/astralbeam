import { Schema } from "effect"

export const APP_NAME = "AstralBeam"

const DEFAULT_PRIVACY_POLICY_URL = "https://www.astralbeam.ai/privacy"
const DEFAULT_TERMS_OF_SERVICE_URL = "https://www.astralbeam.ai/terms"
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
