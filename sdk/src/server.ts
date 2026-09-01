import { base64url, SignJWT } from "jose"

export const ASTRALBEAM_CHAT_TOKEN_AUDIENCE = "astralbeam-chat"
export const ASTRALBEAM_CHAT_TOKEN_ISSUER = "astralbeam-api-key"
export const ASTRALBEAM_CHAT_TOKEN_TYPE = "astralbeam-chat+jwt"
export const ASTRALBEAM_CHAT_TOKEN_VERSION = 2
export const ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS = 300
export const ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS = 600

const API_KEY_PATTERN = /^abo_[A-Za-z]{64}$/
const API_KEY_ID_PATTERN = /^key_[0-9a-z]{1,63}_([0-9a-z]{1,63})$/
const SLUGGED_API_KEY_PATTERN = /^abo_([0-9a-z]{1,63})_[A-Za-z]{64}$/
const CHAT_TOKEN_MAX_BYTES = 16_384
const TENANT_USER_MAX_BYTES = 8_192
const TENANT_USER_MAX_DEPTH = 10
const textEncoder = new TextEncoder()

export interface TenantUser {
  /** User of an Organization's Tenant who interacts with the embedded agent sidebar. */
  readonly id: string
}

export interface CreateAstralBeamChatTokenOptions<TTenantUser extends TenantUser = TenantUser> {
  readonly apiKeyId: string
  readonly apiKey: string
  readonly tenantUser: TTenantUser
  readonly expiresInSeconds?: number | undefined
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

function validateApiKey(apiKey: string, keySlug: string): void {
  const slugged = SLUGGED_API_KEY_PATTERN.exec(apiKey)
  if (slugged) {
    if (slugged[1] !== keySlug) throw new Error("apiKey does not match apiKeyId")
    return
  }
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new Error("apiKey must be an AstralBeam organization API key")
  }
}

function validateJsonValue(value: unknown, depth: number, seen: Set<object>, path: string): void {
  if (depth > TENANT_USER_MAX_DEPTH) {
    throw new Error(`tenantUser must not exceed ${TENANT_USER_MAX_DEPTH} levels`)
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only JSON values`)
    return
  }
  if (typeof value !== "object") throw new Error(`${path} must contain only JSON values`)
  if (seen.has(value)) throw new Error("tenantUser must not contain cycles")
  seen.add(value)

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value)
    if (
      ownKeys.some((key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
      )
    ) {
      throw new Error(`${path} must contain only plain JSON arrays`)
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error(`${path} must not contain sparse arrays`)
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error(`${path} must contain only plain JSON arrays`)
      }
      validateJsonValue(descriptor.value, depth + 1, seen, `${path}[${index}]`)
    }
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain JSON objects`)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error(`${path} must not contain symbol keys`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error(`${path} must contain only plain JSON properties`)
      }
      if (key === "toJSON") throw new Error(`${path} must not define toJSON`)
      validateJsonValue(descriptor.value, depth + 1, seen, `${path}.${key}`)
    }
  }
  seen.delete(value)
}

function validatedTenantUser(value: TenantUser): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("tenantUser must be a plain JSON object")
  }
  validateJsonValue(value, 1, new Set(), "tenantUser")
  if (
    !Object.hasOwn(value, "id") || typeof value.id !== "string" || value.id.length < 1 ||
    value.id.length > 255
  ) {
    throw new Error("tenantUser.id must be a 1-255 character string")
  }
  const serialized = JSON.stringify(value)
  if (textEncoder.encode(serialized).byteLength > TENANT_USER_MAX_BYTES) {
    throw new Error(`tenantUser must not exceed ${TENANT_USER_MAX_BYTES} bytes`)
  }
  return JSON.parse(serialized) as JsonObject
}

async function signingKey(apiKey: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(apiKey))
  // Matches Better Auth's defaultKeyHasher: SHA-256 encoded as unpadded base64url.
  // https://github.com/better-auth/better-auth/blob/v1.7.2/packages/api-key/src/index.ts
  // The encoded digest bytes are intentionally the HMAC key, making database read access a
  // chat-token signing boundary.
  return textEncoder.encode(base64url.encode(new Uint8Array(digest)))
}

/** Creates the short-lived bearer token returned by an application's server auth endpoint. */
export async function createAstralBeamChatToken<TTenantUser extends TenantUser = TenantUser>({
  apiKeyId,
  apiKey,
  tenantUser,
  expiresInSeconds = ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS,
}: CreateAstralBeamChatTokenOptions<TTenantUser>): Promise<string> {
  if (
    !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 ||
    expiresInSeconds > ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("AstralBeam chat tokens must live for 60-600 seconds")
  }
  const apiKeyIdMatch = API_KEY_ID_PATTERN.exec(apiKeyId)
  if (!apiKeyIdMatch?.[1]) {
    throw new Error("apiKeyId must match key_<organization>_<key>")
  }
  validateApiKey(apiKey, apiKeyIdMatch[1])
  const identity = validatedTenantUser(tenantUser)
  const now = Math.floor(Date.now() / 1_000)
  const token = await new SignJWT({
    ver: ASTRALBEAM_CHAT_TOKEN_VERSION,
    tenantUser: identity,
  })
    .setProtectedHeader({ alg: "HS256", typ: ASTRALBEAM_CHAT_TOKEN_TYPE, kid: apiKeyId })
    .setIssuer(ASTRALBEAM_CHAT_TOKEN_ISSUER)
    .setAudience(ASTRALBEAM_CHAT_TOKEN_AUDIENCE)
    .setSubject(tenantUser.id)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(await signingKey(apiKey))
  if (textEncoder.encode(token).byteLength > CHAT_TOKEN_MAX_BYTES) {
    throw new Error(`AstralBeam chat tokens must not exceed ${CHAT_TOKEN_MAX_BYTES} bytes`)
  }
  return token
}
