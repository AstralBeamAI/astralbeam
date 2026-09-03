import { base64url, SignJWT } from "jose"
import * as Schema from "effect/Schema"

export const ASTRALBEAM_TOKEN_AUDIENCE = "astralbeam"
export const ASTRALBEAM_CHAT_TOKEN_TYPE = "astralbeam+jwt"
export const ASTRALBEAM_CHAT_TOKEN_VERSION = 4
export const ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS = 300
export const ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS = 600

const CHAT_TOKEN_MAX_BYTES = 16_384
const IDENTITY_MAX_BYTES = 8_192
const textEncoder = new TextEncoder()

const SlugSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-z-]{1,63}$/)),
)
const ApiKeySecretSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^abo_[A-Za-z]{64}$/)),
)
const ApiKeySchema = Schema.TemplateLiteral([
  "key_",
  SlugSchema,
  "_",
  SlugSchema,
  "_",
  ApiKeySecretSchema,
])
const isApiKey = Schema.is(ApiKeySchema)
const MetadataSchema = Schema.JsonObject.annotate({
  message: "metadata must be a JSON object",
})
const TenantExternalIdSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length >= 1 && value.length <= 255, {
      message: "tenant.id must be a 1-255 character string",
    }),
  ),
)
const TenantUserExternalIdSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length >= 1 && value.length <= 255, {
      message: "user.id must be a 1-255 character string",
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
  name: Schema.optional(Schema.String),
  admin: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(MetadataSchema),
})
const IdentitySchema = Schema.Struct({
  user: TenantUserSchema,
  tenant: TenantSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => textEncoder.encode(JSON.stringify(value)).byteLength <= IDENTITY_MAX_BYTES,
      { message: `user and tenant must not exceed ${IDENTITY_MAX_BYTES} bytes` },
    ),
  ),
)
const decodeIdentity = Schema.decodeUnknownSync(IdentitySchema, {
  errors: "all",
  onExcessProperty: "error",
  reportInput: false,
})

/** Tenant identity from the Organization's application, including JSON metadata. */
export type Tenant = typeof TenantSchema.Type

/** User of an Organization's Tenant who interacts with AstralBeam. */
export type TenantUser = typeof TenantUserSchema.Type

export interface CreateAstralBeamChatTokenOptions<
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
  organizationSlug: string
  keySecret: string
} {
  if (!isApiKey(apiKey)) {
    throw new Error("apiKey must match key_<organization>_<key>_abo_<secret>")
  }
  const separator = apiKey.lastIndexOf("_abo_")
  const keyId = apiKey.slice(0, separator)
  const keySecret = apiKey.slice(separator + 1)
  const organizationSlug = keyId.slice("key_".length, keyId.indexOf("_", "key_".length))
  return { keyId, organizationSlug, keySecret }
}

function validatedIdentity(user: TenantUser, tenant: Tenant): typeof IdentitySchema.Type {
  return JSON.parse(JSON.stringify(decodeIdentity({ user, tenant }))) as typeof IdentitySchema.Type
}

async function signingKey(secret: string) {
  // Matches Better Auth's defaultKeyHasher: SHA-256 encoded as unpadded base64url.
  // https://github.com/better-auth/better-auth/blob/v1.7.2/packages/api-key/src/index.ts
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret))
  return textEncoder.encode(base64url.encode(new Uint8Array(digest)))
}

export interface CreateAstralBeamTokenRouteOptions<
  TSession extends object = object,
  TTenantUser extends TenantUser = TenantUser,
  TTenant extends Tenant = Tenant,
> {
  /** The full API key, or a thunk read per request; missing or empty answers 503. */
  readonly apiKey: string | undefined | (() => string | undefined)
  /**
   * Authenticates the request against the application's own session. Returning nothing, or
   * throwing, answers 401.
   */
  readonly authenticate: (
    request: Request,
  ) => TSession | null | undefined | Promise<TSession | null | undefined>
  /** Maps the authenticated session to the tenant user minted into the token. */
  readonly user: (session: TSession) => TTenantUser
  /** Maps the same authenticated session to the tenant minted into the token. */
  readonly tenant: (session: TSession) => TTenant
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
export function createAstralBeamTokenRoute<
  TSession extends object,
  TTenantUser extends TenantUser = TenantUser,
  TTenant extends Tenant = Tenant,
>(
  options: CreateAstralBeamTokenRouteOptions<TSession, TTenantUser, TTenant>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return tokenRouteResponse({ error: "Use POST" }, 405)
    }
    const apiKey = typeof options.apiKey === "function" ? options.apiKey() : options.apiKey
    if (!apiKey) {
      return tokenRouteResponse({ error: "The AstralBeam API key is not configured" }, 503)
    }
    let session: TSession | null | undefined
    try {
      session = await options.authenticate(request)
    } catch {
      session = undefined
    }
    if (!session) {
      return tokenRouteResponse({ error: "The session could not be verified" }, 401)
    }
    try {
      const token = await createAstralBeamChatToken({
        apiKey,
        user: options.user(session),
        tenant: options.tenant(session),
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
export async function createAstralBeamChatToken<
  TTenantUser extends TenantUser = TenantUser,
  TTenant extends Tenant = Tenant,
>({
  apiKey,
  user,
  tenant,
  expiresInSeconds = ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS,
}: CreateAstralBeamChatTokenOptions<TTenantUser, TTenant>): Promise<string> {
  if (
    !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 ||
    expiresInSeconds > ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("AstralBeam chat tokens must live for 60-600 seconds")
  }
  const { keyId, organizationSlug, keySecret } = parseApiKey(apiKey)
  const identity = validatedIdentity(user, tenant)
  const now = Math.floor(Date.now() / 1_000)
  const token = await new SignJWT({
    ver: ASTRALBEAM_CHAT_TOKEN_VERSION,
    user: identity.user,
    tenant: identity.tenant,
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
