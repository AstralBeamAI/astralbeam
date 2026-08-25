import process from "node:process"

function ensureServerEnv(key: string) {
  const value = process.env[key]
  if (value) return value
  throw new Error(`'${key}' environment variable is not set`)
}

export const DATABASE_URL = ensureServerEnv("DATABASE_URL")

export const BETTER_AUTH_URL = ensureServerEnv("BETTER_AUTH_URL")
export const BETTER_AUTH_SECRET = ensureServerEnv("BETTER_AUTH_SECRET")
export const GOOGLE_CLIENT_ID = ensureServerEnv("GOOGLE_CLIENT_ID")
export const GOOGLE_CLIENT_SECRET = ensureServerEnv("GOOGLE_CLIENT_SECRET")
export const GITHUB_CLIENT_ID = ensureServerEnv("GITHUB_CLIENT_ID")
export const GITHUB_CLIENT_SECRET = ensureServerEnv("GITHUB_CLIENT_SECRET")

// Absolute origin used to build links and image sources for emails, which cannot resolve relative paths.
export const APP_BASE_URL = ensureServerEnv("APP_BASE_URL")

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
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
}
