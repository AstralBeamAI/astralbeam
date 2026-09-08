import { and, eq } from "drizzle-orm"
import { decodeProtectedHeader, jwtVerify } from "jose"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { apiKey, organization } from "@/db/schema.server"
import { ChatAuthTokenPayloadSchema, UuidV7Schema } from "@/lib/schemas"
import {
  CHAT_AUTH_TOKEN_AUDIENCE,
  CHAT_AUTH_TOKEN_IDENTITY_MAX_BYTES,
  CHAT_AUTH_TOKEN_MAX_LENGTH,
  CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS,
  CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS,
  CHAT_AUTH_TOKEN_TYPE,
} from "./constants.server"
import type { ChatAuthenticationError, ChatPrincipal, ChatTenantUser } from "./types"

const textEncoder = new TextEncoder()
const API_KEY_CONFIG_ID = "default"
const ApiKeyIdSchema = Schema.TemplateLiteralParser(["key_", UuidV7Schema, "_", UuidV7Schema])
const decodeApiKeyId = Schema.decodeUnknownOption(ApiKeyIdSchema)
const CLOCK_TOLERANCE_SECONDS = 30
const decodeChatAuthTokenPayload = Schema.decodeUnknownSync(ChatAuthTokenPayloadSchema, {
  onExcessProperty: "error",
})

export function isChatAuthenticationError(error: unknown): error is ChatAuthenticationError {
  return error instanceof Error &&
    (error as Partial<ChatAuthenticationError>).code === "invalid_token"
}

/**
 * Authenticate a chat JWT without the raw API key.
 *
 * This is the deliberate exception to Better Auth's `verifyApiKey`: the host signs offline and
 * `/api/v1/chat` receives only the JWT, so it uses Better Auth's stored SHA-256 digest as the
 * verifier. Database read access is therefore sufficient to forge chat JWTs. Verification is
 * read-only and does not consume Better Auth API-key usage.
 */
export async function authenticateChatRequest(request: Request): Promise<ChatPrincipal> {
  const result = await runDatabaseEffect(
    authenticateOrganizationIssuedToken(request, verifyChatAuthToken),
  )
  return { organization: { id: result.organizationId }, tenantUser: result.identity }
}

/** Shared key ownership/lifecycle verification. The supplied verifier must enforce its own JWT type. */
export function authenticateOrganizationIssuedToken<T>(
  request: Request,
  verify: (token: string, verifier: Uint8Array, keyId: string) => Promise<T>,
) {
  return Effect.gen(function* () {
    const { token, apiKeyId, organizationId, id } = yield* Effect.try({
      try: () => {
        const token = readBearerToken(request)
        const apiKeyId = decodeProtectedHeader(token).kid
        if (typeof apiKeyId !== "string") throw invalidToken("Wrong token header")
        return { token, apiKeyId, ...parseApiKeyId(apiKeyId) }
      },
      catch: (cause) =>
        isChatAuthenticationError(cause) ? cause : invalidToken("Malformed token header", cause),
    })
    const db = yield* effectDatabase
    const [initial] = yield* db.select({
      id: apiKey.id,
      digest: apiKey.key,
      organizationId: organization.id,
    }).from(organization).innerJoin(
      apiKey,
      and(
        eq(apiKey.organizationId, organization.id),
        eq(apiKey.id, id),
        eq(apiKey.configId, API_KEY_CONFIG_ID),
      ),
    ).where(eq(organization.id, organizationId)).limit(1)
    if (!initial) return yield* Effect.fail(invalidToken("API key not found"))

    const verifier = textEncoder.encode(initial.digest)
    const identity = yield* Effect.tryPromise({
      try: () => verify(token, verifier, apiKeyId),
      catch: (cause) =>
        isChatAuthenticationError(cause) ? cause : invalidToken("Invalid bearer token", cause),
    })
    const [current] = yield* db.select({ enabled: apiKey.enabled, expiresAt: apiKey.expiresAt })
      .from(apiKey).where(
        and(
          eq(apiKey.id, initial.id),
          eq(apiKey.organizationId, initial.organizationId),
        ),
      ).limit(1)
    if (!current?.enabled || (current.expiresAt?.getTime() ?? Infinity) <= Date.now()) {
      return yield* Effect.fail(invalidToken("API key is unavailable"))
    }

    return {
      organizationId: initial.organizationId,
      identity,
    }
  })
}

export async function verifyChatAuthToken(
  token: string,
  verifier: Uint8Array,
  apiKeyId: string,
): Promise<ChatTenantUser> {
  try {
    const { organizationId } = parseApiKeyId(apiKeyId)
    const { payload, protectedHeader } = await jwtVerify(token, verifier, {
      algorithms: ["HS256"],
      typ: CHAT_AUTH_TOKEN_TYPE,
      issuer: organizationId,
      audience: CHAT_AUTH_TOKEN_AUDIENCE,
      requiredClaims: ["iat", "exp", "iss", "aud"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS,
    })
    if (protectedHeader.kid !== apiKeyId) throw invalidToken("Wrong API key identifier")
    const identity = { user: payload.user, tenant: payload.tenant }
    if (
      textEncoder.encode(JSON.stringify(identity)).byteLength > CHAT_AUTH_TOKEN_IDENTITY_MAX_BYTES
    ) {
      throw invalidToken("Invalid user or tenant claims")
    }
    const claims = decodeChatAuthTokenPayload(payload)
    if (
      claims.exp <= claims.iat ||
      claims.exp - claims.iat < CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS ||
      claims.exp - claims.iat > CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS
    ) {
      throw invalidToken("Invalid chat auth token claims")
    }
    return { ...claims.user, tenant: claims.tenant }
  } catch (cause) {
    if (isChatAuthenticationError(cause)) throw cause
    throw invalidToken("Invalid chat bearer token", cause)
  }
}

function parseApiKeyId(apiKeyId: string): { organizationId: string; id: string } {
  const publicId = decodeApiKeyId(apiKeyId)
  if (Option.isNone(publicId)) throw invalidToken("Malformed API key identifier")
  const [, organizationId, , id] = publicId.value
  return { organizationId, id }
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization")
  const match = authorization && /^Bearer (\S+)$/i.exec(authorization)
  if (!match?.[1] || match[1].length > CHAT_AUTH_TOKEN_MAX_LENGTH) {
    throw invalidToken("Malformed bearer token")
  }
  return match[1]
}

function invalidToken(message: string, cause?: unknown): ChatAuthenticationError {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return Object.assign(error, { code: "invalid_token" as const })
}
