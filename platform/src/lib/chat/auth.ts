import { and, eq } from "drizzle-orm"
import { Clock, Effect, Schema } from "effect"
import { decodeProtectedHeader, jwtVerify } from "jose"

import { Database } from "@/db/database"
import { apiKey, organization } from "@/db/schema"
import {
  formatApiKeyId,
  ORGANIZATION_API_KEY_CONFIG_ID,
  parseApiKeyId,
} from "@/lib/api-keys/schemas"
import { ChatAuthTokenPayloadSchema } from "./schemas.ts"
import {
  CHAT_AUTH_TOKEN_AUDIENCE,
  CHAT_AUTH_TOKEN_IDENTITY_MAX_BYTES,
  CHAT_AUTH_TOKEN_MAX_LENGTH,
  CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS,
  CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS,
  CHAT_AUTH_TOKEN_TYPE,
} from "./constants"
import { ChatAuthenticationError } from "./errors.ts"
import type { ChatPrincipal, ChatTenantUser } from "./types"

const chatTokenEncoder = new TextEncoder()
const CLOCK_TOLERANCE_SECONDS = 30
const decodeChatAuthTokenPayload = Schema.decodeUnknownEffect(ChatAuthTokenPayloadSchema, {
  onExcessProperty: "error",
})

/**
 * Authenticate a chat JWT without the raw API key.
 *
 * This is the deliberate exception to Better Auth's `verifyApiKey`: the host signs offline and
 * `/api/v1/chat` receives only the JWT, so it uses Better Auth's stored SHA-256 digest as the
 * verifier. Database read access is therefore sufficient to forge chat JWTs. Verification is
 * read-only and does not consume Better Auth API-key usage.
 */
export const authenticateChatRequest = Effect.fn("authenticateChatRequest")(function* (
  request: Request,
) {
  const result = yield* authenticateOrganizationIssuedToken(request, verifyChatAuthToken)
  const principal: ChatPrincipal = {
    organization: { id: result.organizationId },
    tenantUser: result.identity,
  }
  return principal
})

/** Shared key ownership/lifecycle verification. The supplied verifier must enforce its own JWT type. */
export const authenticateOrganizationIssuedToken = Effect.fn("authenticateOrganizationIssuedToken")(
  function* <T>(
    request: Request,
    verify: (
      token: string,
      verifier: Uint8Array,
      keyId: string,
    ) => Effect.Effect<T, ChatAuthenticationError>,
  ) {
    const token = yield* readChatBearerToken(request)
    const { apiKeyId, organizationId, id } = yield* Effect.try({
      try: () => decodeProtectedHeader(token).kid,
      catch: () => new ChatAuthenticationError(),
    }).pipe(Effect.flatMap(parseChatApiKeyId))
    const db = yield* Database
    const [initial] = yield* db
      .select({
        id: apiKey.id,
        digest: apiKey.key,
        organizationId: organization.id,
      })
      .from(organization)
      .innerJoin(
        apiKey,
        and(
          eq(apiKey.organizationId, organization.id),
          eq(apiKey.id, id),
          eq(apiKey.configId, ORGANIZATION_API_KEY_CONFIG_ID),
        ),
      )
      .where(eq(organization.id, organizationId))
      .limit(1)
      .pipe(Effect.orDie)
    if (!initial) return yield* new ChatAuthenticationError()

    const identity = yield* verify(token, chatTokenEncoder.encode(initial.digest), apiKeyId)
    const [current] = yield* db
      .select({ enabled: apiKey.enabled, expiresAt: apiKey.expiresAt })
      .from(apiKey)
      .where(and(eq(apiKey.id, initial.id), eq(apiKey.organizationId, initial.organizationId)))
      .limit(1)
      .pipe(Effect.orDie)
    const now = yield* Clock.currentTimeMillis
    if (!current?.enabled || (current.expiresAt?.getTime() ?? Infinity) <= now) {
      return yield* new ChatAuthenticationError()
    }

    return { organizationId: initial.organizationId, identity }
  },
)

export const verifyChatAuthToken = Effect.fn("verifyChatAuthToken")(function* (
  token: string,
  verifier: Uint8Array,
  apiKeyId: string,
) {
  const { organizationId } = yield* parseChatApiKeyId(apiKeyId)
  const { payload, protectedHeader } = yield* Effect.tryPromise({
    try: () =>
      jwtVerify(token, verifier, {
        algorithms: ["HS256"],
        typ: CHAT_AUTH_TOKEN_TYPE,
        issuer: organizationId,
        audience: CHAT_AUTH_TOKEN_AUDIENCE,
        requiredClaims: ["iat", "exp", "iss", "aud"],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS,
      }),
    catch: () => new ChatAuthenticationError(),
  })
  const identity = JSON.stringify({ user: payload.user, tenant: payload.tenant })
  if (
    protectedHeader.kid !== apiKeyId ||
    chatTokenEncoder.encode(identity).byteLength > CHAT_AUTH_TOKEN_IDENTITY_MAX_BYTES
  ) {
    return yield* new ChatAuthenticationError()
  }
  const claims = yield* decodeChatAuthTokenPayload(payload).pipe(
    Effect.mapError(() => new ChatAuthenticationError()),
  )
  const lifetime = claims.exp - claims.iat
  if (
    lifetime < CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS ||
    lifetime > CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    return yield* new ChatAuthenticationError()
  }
  const tenantUser: ChatTenantUser = { ...claims.user, tenant: claims.tenant }
  return tenantUser
})

function parseChatApiKeyId(apiKeyId: unknown) {
  const key = parseApiKeyId(apiKeyId)
  return key
    ? Effect.succeed({ apiKeyId: formatApiKeyId(key), ...key })
    : Effect.fail(new ChatAuthenticationError())
}

/** The token an `Authorization: Bearer` header carries. */
export function readBearerToken(request: Request): string | undefined {
  return /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
}

function readChatBearerToken(request: Request) {
  const token = readBearerToken(request)
  return token && token.length <= CHAT_AUTH_TOKEN_MAX_LENGTH
    ? Effect.succeed(token)
    : Effect.fail(new ChatAuthenticationError())
}
