import process from "node:process"

function ensureServerEnv(key: string) {
  const value = process.env[key]
  if (value) return value
  throw new Error(`'${key}' environment variable is not set`)
}

export const DATABASE_URL = ensureServerEnv("DATABASE_URL")

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
