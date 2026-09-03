import { base64url, SignJWT } from "jose"
import * as Schema from "effect/Schema"

export const ASTRALBEAM_TOKEN_AUDIENCE = "astralbeam"
export const ASTRALBEAM_CHAT_TOKEN_TYPE = "astralbeam+jwt"
export const ASTRALBEAM_CHAT_TOKEN_VERSION = 3
export const ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS = 300
export const ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS = 600

const API_KEY_ID_PATTERN = /^key_([0-9a-z-]{1,63})_([0-9a-z-]{1,63})$/
const API_KEY_SECRET_PATTERN = /^abo_[A-Za-z]{64}$/
const CHAT_TOKEN_MAX_BYTES = 16_384
const TENANT_USER_MAX_BYTES = 8_192
const TENANT_USER_MAX_DEPTH = 10
const textEncoder = new TextEncoder()

const MetadataSchema = Schema.JsonObject.annotate({
  message: "metadata must be a JSON object",
})
const TenantExternalIdSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length >= 1 && value.length <= 255, {
      message: "tenantUser.tenant.id must be a 1-255 character string",
    }),
  ),
)
const TenantUserExternalIdSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length >= 1 && value.length <= 255, {
      message: "tenantUser.id must be a 1-255 character string",
    }),
  ),
)
export const TenantSchema = Schema.Struct({
  id: TenantExternalIdSchema,
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(MetadataSchema),
})
export const TenantUserSchema = Schema.Struct({
  id: TenantUserExternalIdSchema,
  tenant: TenantSchema,
  name: Schema.optional(Schema.String),
  admin: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(MetadataSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((value) => !exceedsJsonDepth(value, TENANT_USER_MAX_DEPTH), {
      message: `tenantUser must not exceed ${TENANT_USER_MAX_DEPTH} levels`,
    }),
  ),
  Schema.check(
    Schema.makeFilter(
      (value) => textEncoder.encode(JSON.stringify(value)).byteLength <= TENANT_USER_MAX_BYTES,
      { message: `tenantUser must not exceed ${TENANT_USER_MAX_BYTES} bytes` },
    ),
  ),
)
const decodeTenantUser = Schema.decodeUnknownSync(TenantUserSchema, {
  errors: "all",
  onExcessProperty: "error",
  reportInput: false,
})

/** Tenant identity from the Organization's application, including JSON metadata. */
export type Tenant = Pick<typeof TenantSchema.Type, "id" | "name"> & {
  readonly metadata?: object | undefined
}

/** User of an Organization's Tenant who interacts with AstralBeam. */
export type TenantUser = Pick<typeof TenantUserSchema.Type, "id" | "name" | "admin"> & {
  readonly tenant: Tenant
  readonly metadata?: object | undefined
}

export interface CreateAstralBeamChatTokenOptions<TTenantUser extends TenantUser = TenantUser> {
  readonly apiKey: string
  readonly tenantUser: TTenantUser
  readonly expiresInSeconds?: number | undefined
}

function parseApiKey(apiKey: string): {
  keyId: string
  organizationSlug: string
  keySecret: string
} {
  const separator = apiKey.lastIndexOf("_abo_")
  const keyId = apiKey.slice(0, separator)
  const keySecret = apiKey.slice(separator + 1)
  const publicId = API_KEY_ID_PATTERN.exec(keyId)
  const organizationSlug = publicId?.[1]
  if (!organizationSlug || !API_KEY_SECRET_PATTERN.test(keySecret)) {
    throw new Error("apiKey must match key_<organization>_<key>_abo_<secret>")
  }
  return { keyId, organizationSlug, keySecret }
}

function exceedsJsonDepth(value: unknown, maximumDepth: number): boolean {
  const stack = [{ value, depth: 1 }]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.depth > maximumDepth) return true
    if (typeof current.value !== "object" || current.value === null) continue
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value)
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 })
  }
  return false
}

function validatedTenantUser(value: TenantUser): typeof TenantUserSchema.Type {
  return JSON.parse(JSON.stringify(decodeTenantUser(value))) as typeof TenantUserSchema.Type
}

async function signingKey(secret: string) {
  // Matches Better Auth's defaultKeyHasher: SHA-256 encoded as unpadded base64url.
  // https://github.com/better-auth/better-auth/blob/v1.7.2/packages/api-key/src/index.ts
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))
  return textEncoder.encode(base64url.encode(new Uint8Array(digest)))
}

export interface CreateAstralBeamTokenRouteOptions<TTenantUser extends TenantUser = TenantUser> {
  /** The full API key, or a thunk read per request; missing or empty answers 503. */
  readonly apiKey: string | undefined | (() => string | undefined)
  /**
   * Authenticates the request against the application's own session and returns the tenant
   * user minted into the token. Returning nothing, or throwing, answers 401.
   */
  readonly tenantUser: (
    request: Request,
  ) => TTenantUser | null | undefined | Promise<TTenantUser | null | undefined>
  readonly expiresInSeconds?: number | undefined
}

// Every response carries no-store: a cached token would outlive its short expiry.
function tokenRouteResponse(body: Record<string, string>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

/**
 * Builds the fetch-standard `POST` handler for an application's token endpoint, owning the
 * method check, the unconfigured-key 503, the unauthenticated 401, and the `no-store` header.
 */
export function createAstralBeamTokenRoute<TTenantUser extends TenantUser = TenantUser>(
  options: CreateAstralBeamTokenRouteOptions<TTenantUser>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return tokenRouteResponse({ error: "Use POST" }, 405)
    }
    const apiKey = typeof options.apiKey === "function" ? options.apiKey() : options.apiKey
    if (!apiKey) {
      return tokenRouteResponse({ error: "The AstralBeam API key is not configured" }, 503)
    }
    let tenantUser: TTenantUser | null | undefined
    try {
      tenantUser = await options.tenantUser(request)
    } catch {
      tenantUser = undefined
    }
    if (!tenantUser) {
      return tokenRouteResponse({ error: "The session could not be verified" }, 401)
    }
    try {
      const token = await createAstralBeamChatToken({
        apiKey,
        tenantUser,
        ...(options.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: options.expiresInSeconds }),
      })
      return tokenRouteResponse({ token }, 200)
    } catch {
      // The thrown message can describe the API key's expected shape; never send it to a client.
      return tokenRouteResponse({ error: "The chat token could not be created" }, 500)
    }
  }
}

/** Creates the short-lived bearer token returned by an application's server auth endpoint. */
export async function createAstralBeamChatToken<TTenantUser extends TenantUser = TenantUser>({
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
  const { keyId, organizationSlug, keySecret } = parseApiKey(apiKey)
  const identity = validatedTenantUser(tenantUser)
  const now = Math.floor(Date.now() / 1_000)
  const token = await new SignJWT({
    ver: ASTRALBEAM_CHAT_TOKEN_VERSION,
    tenantUser: identity,
  })
    .setProtectedHeader({ alg: "HS256", typ: ASTRALBEAM_CHAT_TOKEN_TYPE, kid: keyId })
    .setIssuer(organizationSlug)
    .setAudience(ASTRALBEAM_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(await signingKey(keySecret))
  if (textEncoder.encode(token).byteLength > CHAT_TOKEN_MAX_BYTES) {
    throw new Error(`AstralBeam chat tokens must not exceed ${CHAT_TOKEN_MAX_BYTES} bytes`)
  }
  return token
}
