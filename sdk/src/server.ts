import { base64url, SignJWT } from "jose"
import * as Schema from "effect/Schema"

export const ASTRALBEAM_CHAT_TOKEN_AUDIENCE = "astralbeam-chat"
export const ASTRALBEAM_CHAT_TOKEN_ISSUER = "astralbeam-api-key"
export const ASTRALBEAM_CHAT_TOKEN_TYPE = "astralbeam-chat+jwt"
export const ASTRALBEAM_CHAT_TOKEN_VERSION = 2
export const ASTRALBEAM_CHAT_TOKEN_LIFETIME_SECONDS = 300
export const ASTRALBEAM_CHAT_TOKEN_MAX_LIFETIME_SECONDS = 600

const API_KEY_PREFIX_PATTERN = /^(key_[0-9a-z]{1,63}_([0-9a-z]{1,63}))_abo$/
const API_KEY_SECRET_PATTERN = /^[A-Za-z]{64}$/
const CHAT_TOKEN_MAX_BYTES = 16_384
const TENANT_USER_MAX_BYTES = 8_192
const TENANT_USER_MAX_DEPTH = 10
const textEncoder = new TextEncoder()

const TenantUserJsonSchema = Schema.Json.annotate({
  message: "tenantUser must contain only JSON values",
})
const TenantUserSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String.pipe(
      Schema.check(
        Schema.makeFilter((value) => value.length >= 1 && value.length <= 255, {
          message: "tenantUser.id must be a 1-255 character string",
        }),
      ),
    ),
  }),
  [Schema.Record(Schema.String, TenantUserJsonSchema)],
).pipe(
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

export interface TenantUser {
  /** User of an Organization's Tenant who interacts with the embedded agent sidebar. */
  readonly id: string
}

export interface CreateAstralBeamChatTokenOptions<TTenantUser extends TenantUser = TenantUser> {
  readonly apiKey: string
  readonly tenantUser: TTenantUser
  readonly expiresInSeconds?: number | undefined
}

function parseApiKey(apiKey: string): { id: string; secret: string } {
  const separator = apiKey.lastIndexOf("_")
  const secret = apiKey.slice(separator + 1)
  const idMatch = API_KEY_PREFIX_PATTERN.exec(apiKey.slice(0, separator))
  if (!idMatch?.[1] || !API_KEY_SECRET_PATTERN.test(secret)) {
    throw new Error("apiKey must match key_<organization>_<key>_abo_<secret>")
  }
  return { id: idMatch[1], secret: `abo_${idMatch[2]}_${secret}` }
}

function exceedsJsonDepth(value: Schema.Json, maximumDepth: number): boolean {
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
  const { id: apiKeyId, secret } = parseApiKey(apiKey)
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
    .sign(await signingKey(secret))
  if (textEncoder.encode(token).byteLength > CHAT_TOKEN_MAX_BYTES) {
    throw new Error(`AstralBeam chat tokens must not exceed ${CHAT_TOKEN_MAX_BYTES} bytes`)
  }
  return token
}
