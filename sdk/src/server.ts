import { SignJWT } from "jose"

export const ASTRALBEAM_CHAT_TOKEN_AUDIENCE = "astralbeam-chat"
export const ASTRALBEAM_CHAT_TOKEN_ISSUER = "astralbeam-global"
export const ASTRALBEAM_CHAT_TOKEN_TYPE = "astralbeam-chat+jwt"
export const ASTRALBEAM_CHAT_TOKEN_KEY_ID = "global-v1"
export const ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS = 300
export const ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS = 600

export interface AstralBeamChatUser {
  id: string
  name?: string | undefined
  email?: string | undefined
  avatarUrl?: string | undefined
}

export interface AstralBeamChatTenant {
  id: string
  name?: string | undefined
  logoUrl?: string | undefined
}

export interface CreateAstralBeamChatTokenOptions {
  secret: string | Uint8Array
  user: AstralBeamChatUser
  tenant: AstralBeamChatTenant
  expiresInSeconds?: number | undefined
}

const textEncoder = new TextEncoder()

function signingKey(secret: string | Uint8Array): Uint8Array {
  const key = typeof secret === "string" ? textEncoder.encode(secret) : secret
  if (key.byteLength < 32) throw new Error("AstralBeam chat signing secrets need at least 32 bytes")
  return key
}

function requiredText(value: string, label: string, maxLength: number): string {
  const text = value.trim()
  if (!text || text.length > maxLength) {
    throw new Error(`${label} must be 1-${maxLength} characters`)
  }
  return text
}

function optionalText(value: string | undefined, label: string, maxLength: number) {
  if (value === undefined) return undefined
  return requiredText(value, label, maxLength)
}

function optionalUrl(value: string | undefined, label: string) {
  const text = optionalText(value, label, 2_048)
  if (text === undefined) return undefined
  const url = new URL(text)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`)
  }
  return url.href
}

/** Creates the short-lived bearer token returned by an application's auth endpoint. */
export async function createAstralBeamChatToken(
  { secret, user, tenant, expiresInSeconds = ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS }:
    CreateAstralBeamChatTokenOptions,
): Promise<string> {
  if (
    !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 ||
    expiresInSeconds > ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("AstralBeam chat tokens must live for 60-600 seconds")
  }
  const userId = requiredText(user.id, "user.id", 255)
  const tenantId = requiredText(tenant.id, "tenant.id", 255)
  const now = Math.floor(Date.now() / 1_000)
  return await new SignJWT({
    ver: 1,
    user: {
      id: userId,
      name: optionalText(user.name, "user.name", 200),
      email: optionalText(user.email, "user.email", 320),
      avatarUrl: optionalUrl(user.avatarUrl, "user.avatarUrl"),
    },
    tenant: {
      id: tenantId,
      name: optionalText(tenant.name, "tenant.name", 200),
      logoUrl: optionalUrl(tenant.logoUrl, "tenant.logoUrl"),
    },
  })
    .setProtectedHeader({
      alg: "HS256",
      typ: ASTRALBEAM_CHAT_TOKEN_TYPE,
      kid: ASTRALBEAM_CHAT_TOKEN_KEY_ID,
    })
    .setIssuer(ASTRALBEAM_CHAT_TOKEN_ISSUER)
    .setAudience(ASTRALBEAM_CHAT_TOKEN_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(signingKey(secret))
}
