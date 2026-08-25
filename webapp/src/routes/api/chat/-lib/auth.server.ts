import { jwtVerify } from "jose"

import {
  CHAT_TOKEN_AUDIENCE,
  CHAT_TOKEN_ISSUER,
  CHAT_TOKEN_KEY_ID,
  CHAT_TOKEN_MAX_LENGTH,
  CHAT_TOKEN_MAX_LIFETIME_SECONDS,
  CHAT_TOKEN_TYPE,
} from "./constants.server"
import type {
  ChatAuthenticationError,
  ChatAuthenticationErrorCode,
  ChatPrincipal,
  ChatTenantPrincipal,
  ChatUserPrincipal,
} from "./types"

function chatAuthenticationError(
  { message, code, cause }: {
    message: string
    code: ChatAuthenticationErrorCode
    cause?: unknown
  },
): ChatAuthenticationError {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return Object.assign(error, { code })
}

export function isChatAuthenticationError(error: unknown): error is ChatAuthenticationError {
  return error instanceof Error &&
    (error as Partial<ChatAuthenticationError>).code === "invalid_token"
}

export function isChatAuthenticationConfigurationError(
  error: unknown,
): error is ChatAuthenticationError {
  return error instanceof Error &&
    (error as Partial<ChatAuthenticationError>).code === "verifier_not_configured"
}

const textEncoder = new TextEncoder()

function recordClaim(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw chatAuthenticationError({ message: `${label} must be an object`, code: "invalid_token" })
  }
  return value as Record<string, unknown>
}

function textClaim(
  record: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
  optional = false,
): string | undefined {
  const value = record[key]
  if (value === undefined && optional) return undefined
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw chatAuthenticationError({ message: `${label} is invalid`, code: "invalid_token" })
  }
  return value
}

function urlClaim(record: Record<string, unknown>, key: string, label: string) {
  const value = textClaim(record, key, label, 2_048, true)
  if (value === undefined) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw chatAuthenticationError({ message: `${label} is invalid`, code: "invalid_token" })
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw chatAuthenticationError({ message: `${label} is invalid`, code: "invalid_token" })
  }
  return value
}

function userPrincipal(value: unknown): ChatUserPrincipal {
  const user = recordClaim(value, "user")
  return {
    id: textClaim(user, "id", "user.id", 255)!,
    name: textClaim(user, "name", "user.name", 200, true),
    email: textClaim(user, "email", "user.email", 320, true),
    avatarUrl: urlClaim(user, "avatarUrl", "user.avatarUrl"),
  }
}

function tenantPrincipal(value: unknown): ChatTenantPrincipal {
  const tenant = recordClaim(value, "tenant")
  return {
    id: textClaim(tenant, "id", "tenant.id", 255)!,
    name: textClaim(tenant, "name", "tenant.name", 200, true),
    logoUrl: urlClaim(tenant, "logoUrl", "tenant.logoUrl"),
  }
}

/** Verifies an optional bearer token; a supplied but invalid token never degrades to guest. */
export async function authenticateChatRequest(
  request: Request,
  secret: string | undefined,
): Promise<ChatPrincipal> {
  const authorization = request.headers.get("authorization")
  if (!authorization) return { kind: "guest" }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  if (!match?.[1] || match[1].length > CHAT_TOKEN_MAX_LENGTH) {
    throw chatAuthenticationError({ message: "Malformed bearer token", code: "invalid_token" })
  }
  if (!secret || textEncoder.encode(secret).byteLength < 32) {
    throw chatAuthenticationError({
      message: "Chat token verification is not configured",
      code: "verifier_not_configured",
    })
  }
  try {
    const { payload, protectedHeader } = await jwtVerify(match[1], textEncoder.encode(secret), {
      algorithms: ["HS256"],
      issuer: CHAT_TOKEN_ISSUER,
      audience: CHAT_TOKEN_AUDIENCE,
      requiredClaims: ["iat", "exp", "sub"],
      clockTolerance: 30,
      maxTokenAge: CHAT_TOKEN_MAX_LIFETIME_SECONDS,
    })
    if (protectedHeader.typ !== CHAT_TOKEN_TYPE || protectedHeader.kid !== CHAT_TOKEN_KEY_ID) {
      throw chatAuthenticationError({ message: "Wrong chat token type", code: "invalid_token" })
    }
    if (
      payload.ver !== 1 || typeof payload.iat !== "number" || typeof payload.exp !== "number" ||
      !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
      payload.exp <= payload.iat || payload.exp - payload.iat > CHAT_TOKEN_MAX_LIFETIME_SECONDS ||
      typeof payload.sub !== "string"
    ) {
      throw chatAuthenticationError({ message: "Invalid chat token claims", code: "invalid_token" })
    }
    const user = userPrincipal(payload.user)
    if (user.id !== payload.sub) {
      throw chatAuthenticationError({
        message: "Chat token subject mismatch",
        code: "invalid_token",
      })
    }
    return {
      kind: "authenticated",
      user,
      tenant: tenantPrincipal(payload.tenant),
    }
  } catch (error) {
    if (isChatAuthenticationError(error)) throw error
    throw chatAuthenticationError({
      message: "Invalid chat bearer token",
      code: "invalid_token",
      cause: error,
    })
  }
}
