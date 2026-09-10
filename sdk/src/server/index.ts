import { base64url, SignJWT } from "jose"

export const CHAT_AUTH_TOKEN_AUDIENCE = "astralbeam"
export const CHAT_AUTH_TOKEN_TYPE = "astralbeam+jwt"
export const CHAT_AUTH_TOKEN_VERSION = 4
export const CHAT_AUTH_TOKEN_LIFETIME_SECONDS = 300
export const CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS = 600

const CHAT_AUTH_TOKEN_MAX_BYTES = 16_384
const IDENTITY_MAX_BYTES = 8_192
const EXTERNAL_ID_MAX_LENGTH = 255
// key_<organization ID>_<key ID>_abo_<Better Auth secret>; neither UUIDv7 ID can hold an
// underscore, so the whole key parses by its separators.
const API_KEY_PATTERN =
  /^key_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_abo_[A-Za-z]{64}$/
const TENANT_FIELDS = ["id", "name", "metadata"]
const TENANT_USER_FIELDS = ["id", "name", "admin", "metadata"]
const textEncoder = new TextEncoder()

/** A JSON value, which is all a `metadata` object may hold: the token carries it verbatim. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** A `metadata` object: caller-owned keys, preserved verbatim in the token's claims. */
export type JsonMetadata = { readonly [key: string]: JsonValue }

/** Tenant identity from the Organization's application, including JSON metadata. */
export interface Tenant {
  readonly id: string
  readonly name?: string | undefined
  readonly metadata?: JsonMetadata | undefined
}

/** User of an Organization's Tenant who interacts with AstralBeam. */
export interface TenantUser {
  readonly id: string
  readonly name?: string | undefined
  readonly admin?: boolean | undefined
  readonly metadata?: JsonMetadata | undefined
}

export interface CreateAstralBeamTokenOptions<
  TTenantUser extends TenantUser = TenantUser,
  TTenant extends Tenant = Tenant,
> {
  readonly apiKey: string
  readonly user: TTenantUser
  readonly tenant: TTenant
  readonly expiresInSeconds?: number | undefined
}

function parseApiKey(apiKey: string): {
  keyId: string
  organizationId: string
  keySecret: string
} {
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new Error("apiKey must match key_<organizationId>_<id>_abo_<secret>")
  }
  const separator = apiKey.lastIndexOf("_abo_")
  const keyId = apiKey.slice(0, separator)
  const keySecret = apiKey.slice(separator + 1)
  const organizationId = keyId.slice("key_".length, keyId.indexOf("_", "key_".length))
  return { keyId, organizationId, keySecret }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Only what JSON.stringify preserves as-is: a class instance, a function, a `toJSON` hook or a
// non-finite number would otherwise be rewritten on the way into a signed claim.
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isPlainObject(value) && Object.values(value).every(isJsonValue)
}

// One identity object's wire contract. Unknown fields are rejected rather than dropped: a
// custom claim written beside `metadata` would otherwise vanish without the caller noticing.
function validateIdentity(label: "user" | "tenant", value: unknown, isUser: boolean): void {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`)
  const fields = isUser ? TENANT_USER_FIELDS : TENANT_FIELDS
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new Error(`${label} has an unknown field "${key}"`)
  }
  const { id, name, admin, metadata } = value
  if (typeof id !== "string" || id.length < 1 || id.length > EXTERNAL_ID_MAX_LENGTH) {
    throw new Error(`${label}.id must be a 1-${EXTERNAL_ID_MAX_LENGTH} character string`)
  }
  if (name !== undefined && typeof name !== "string") {
    throw new Error(`${label}.name must be a string`)
  }
  if (isUser && admin !== undefined && typeof admin !== "boolean") {
    throw new Error(`${label}.admin must be a boolean`)
  }
  if (metadata !== undefined && !(isPlainObject(metadata) && isJsonValue(metadata))) {
    throw new Error(`${label}.metadata must be a JSON object`)
  }
}

function validatedIdentity(user: TenantUser, tenant: Tenant): { user: TenantUser; tenant: Tenant } {
  validateIdentity("user", user, true)
  validateIdentity("tenant", tenant, false)
  const identity = { user, tenant }
  const json = JSON.stringify(identity)
  if (textEncoder.encode(json).byteLength > IDENTITY_MAX_BYTES) {
    throw new Error(`user and tenant must not exceed ${IDENTITY_MAX_BYTES} bytes`)
  }
  // Round-tripped so the claims carry plain JSON data, whatever the caller's objects were.
  return JSON.parse(json) as { user: TenantUser; tenant: Tenant }
}

async function signingKey(secret: string) {
  // Matches Better Auth's defaultKeyHasher: SHA-256 encoded as unpadded base64url.
  // https://github.com/better-auth/better-auth/blob/v1.7.2/packages/api-key/src/index.ts
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))
  return textEncoder.encode(base64url.encode(new Uint8Array(digest)))
}

export interface CreateAstralBeamOrganizationTokenOptions {
  readonly apiKey: string
  /** Host-authenticated email of an existing organization member, never browser-supplied identity. */
  readonly email: string
  readonly organizationId: string
  readonly expiresInSeconds?: number | undefined
}

/** Delegates a member's current database permissions. Does not restrict the API-key holder's authority. */
export async function createAstralBeamOrganizationToken({
  apiKey,
  email,
  organizationId,
  expiresInSeconds = CHAT_AUTH_TOKEN_LIFETIME_SECONDS,
}: CreateAstralBeamOrganizationTokenOptions): Promise<string> {
  if (
    typeof email !== "string" || email.length > 320 || email.includes("\0") ||
    !/^[^\s@]+@[^\s@]+$/.test(email)
  ) {
    throw new Error("email must be an email address of at most 320 characters")
  }
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 600) {
    throw new Error("organization auth tokens must live for 60-600 seconds")
  }
  const { keyId, organizationId: keyOrganizationId, keySecret } = parseApiKey(apiKey)
  if (organizationId !== keyOrganizationId) {
    throw new Error("organizationId must match the API key organization")
  }
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ ver: 1, email, organization_id: organizationId })
    .setProtectedHeader({ alg: "HS256", typ: "astralbeam-organization+jwt", kid: keyId })
    .setIssuer(organizationId)
    .setAudience(CHAT_AUTH_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(await signingKey(keySecret))
}

/** Creates the short-lived bearer token returned by an application's server auth endpoint. */
export async function createAstralBeamToken<
  TTenantUser extends TenantUser = TenantUser,
  TTenant extends Tenant = Tenant,
>({
  apiKey,
  user,
  tenant,
  expiresInSeconds = CHAT_AUTH_TOKEN_LIFETIME_SECONDS,
}: CreateAstralBeamTokenOptions<TTenantUser, TTenant>): Promise<string> {
  if (
    !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 ||
    expiresInSeconds > CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("chat auth tokens must live for 60-600 seconds")
  }
  const { keyId, organizationId, keySecret } = parseApiKey(apiKey)
  const identity = validatedIdentity(user, tenant)
  const now = Math.floor(Date.now() / 1_000)
  const token = await new SignJWT({
    ver: CHAT_AUTH_TOKEN_VERSION,
    user: identity.user,
    tenant: identity.tenant,
  })
    .setProtectedHeader({ alg: "HS256", typ: CHAT_AUTH_TOKEN_TYPE, kid: keyId })
    .setIssuer(organizationId)
    .setAudience(CHAT_AUTH_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(await signingKey(keySecret))
  if (textEncoder.encode(token).byteLength > CHAT_AUTH_TOKEN_MAX_BYTES) {
    throw new Error(`chat auth tokens must not exceed ${CHAT_AUTH_TOKEN_MAX_BYTES} bytes`)
  }
  return token
}
