import process from "node:process"
import { Schema } from "effect"

const decodeRequiredEnvironmentValue = Schema.decodeUnknownSync(Schema.NonEmptyString)
const decodeServerOrigin = Schema.decodeUnknownSync(
  Schema.URLFromString.pipe(
    Schema.check(Schema.makeFilter(isServerOrigin)),
  ),
)
const decodeServerSecret = Schema.decodeUnknownSync(
  Schema.String.pipe(Schema.check(Schema.isMinLength(32))),
)

function ensureServerEnv(key: string): string {
  try {
    return decodeRequiredEnvironmentValue(process.env[key])
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new Error(`'${key}' environment variable is not set`)
  }
}

function ensureServerOrigin(key: string): string {
  const value = ensureServerEnv(key)
  try {
    return decodeServerOrigin(value).origin
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new Error(
      `'${key}' must be an HTTP(S) origin without credentials, path, query, or fragment, and must use HTTPS outside local development`,
    )
  }
}

function isServerOrigin(url: URL): boolean {
  return (url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function ensureServerSecret(key: string): string {
  const value = ensureServerEnv(key)
  try {
    return decodeServerSecret(value)
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new Error(`'${key}' must be at least 32 characters`)
  }
}

export const DATABASE_URL = ensureServerEnv("DATABASE_URL")

// Absolute origin used to build links and image sources for emails, which cannot resolve relative paths.
export const APP_BASE_URL = ensureServerOrigin("APP_BASE_URL")
export const BETTER_AUTH_URL = ensureServerOrigin("BETTER_AUTH_URL")
export const BETTER_AUTH_SECRET = ensureServerSecret("BETTER_AUTH_SECRET")
export const GOOGLE_CLIENT_ID = ensureServerEnv("GOOGLE_CLIENT_ID")
export const GOOGLE_CLIENT_SECRET = ensureServerEnv("GOOGLE_CLIENT_SECRET")
export const GITHUB_CLIENT_ID = ensureServerEnv("GITHUB_CLIENT_ID")
export const GITHUB_CLIENT_SECRET = ensureServerEnv("GITHUB_CLIENT_SECRET")

// Keep auth cookies and callbacks on the application origin. https://better-auth.com/docs/reference/security
if (APP_BASE_URL !== BETTER_AUTH_URL) {
  throw new Error("'APP_BASE_URL' and 'BETTER_AUTH_URL' must use the same application origin")
}

// Defaults for `src/emails`; every `sendEmail` call can override either one.
export const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER
export const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS

// Provider credentials are read through functions, not module constants, so a deployment only needs
// the variables for the email providers it actually sends through.
export function requireResendConfig() {
  return { apiKey: ensureServerEnv("RESEND_API_KEY") }
}

export function requireSesConfig() {
  return {
    region: ensureServerEnv("AWS_REGION"),
  }
}
