import { and, eq } from "drizzle-orm"
import { decodeProtectedHeader, jwtVerify } from "jose"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { apiKey, organization } from "@/db/schema.server"
import { ChatTokenPayloadSchema, SlugSchema } from "@/lib/schemas"
import {
  CHAT_TOKEN_AUDIENCE,
  CHAT_TOKEN_IDENTITY_MAX_BYTES,
  CHAT_TOKEN_MAX_LENGTH,
  CHAT_TOKEN_MAX_LIFETIME_SECONDS,
  CHAT_TOKEN_MIN_LIFETIME_SECONDS,
  CHAT_TOKEN_TYPE,
} from "./constants.server"
import type { ChatAuthenticationError, ChatPrincipal, ChatTenantUser } from "./types"

const textEncoder = new TextEncoder()
const API_KEY_CONFIG_ID = "default"
const ApiKeyIdSchema = Schema.TemplateLiteralParser(["key_", SlugSchema, "_", SlugSchema])
const decodeApiKeyId = Schema.decodeUnknownOption(ApiKeyIdSchema)
const CLOCK_TOLERANCE_SECONDS = 30
const decodeChatTokenPayload = Schema.decodeUnknownSync(ChatTokenPayloadSchema, {
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
 * `/api/chat` receives only the JWT, so it uses Better Auth's stored SHA-256 digest as the
 * verifier. Database read access is therefore sufficient to forge chat JWTs. Verification is
 * read-only and does not consume Better Auth API-key usage.
 */
export async function authenticateChatRequest(request: Request): Promise<ChatPrincipal> {
  const token = readBearerToken(request)
  let protectedHeader
  try {
    protectedHeader = decodeProtectedHeader(token)
  } catch (cause) {
    throw invalidToken("Malformed chat token header", cause)
  }
  const apiKeyId = protectedHeader.kid
  if (typeof apiKeyId !== "string") throw invalidToken("Wrong chat token header")
  const { organizationSlug, keySlug } = parseApiKeyId(apiKeyId)

  const [initial] = await runDatabaseEffect(
    Effect.flatMap(effectDatabase, (db) =>
      db.select({
        id: apiKey.id,
        digest: apiKey.key,
        organizationId: organization.id,
      }).from(organization).innerJoin(
        apiKey,
        and(
          eq(apiKey.organizationId, organization.id),
          eq(apiKey.slug, keySlug),
          eq(apiKey.configId, API_KEY_CONFIG_ID),
        ),
      ).where(eq(organization.slug, organizationSlug)).limit(1)),
  )
  if (!initial) throw invalidToken("API key not found")

  const verifier = textEncoder.encode(initial.digest)
  const tenantUser = await verifyChatToken(token, verifier, apiKeyId)
  const [current] = await runDatabaseEffect(
    Effect.flatMap(
      effectDatabase,
      (db) =>
        db.select({ enabled: apiKey.enabled, expiresAt: apiKey.expiresAt }).from(apiKey).where(
          and(
            eq(apiKey.id, initial.id),
            eq(apiKey.organizationId, initial.organizationId),
          ),
        ).limit(1),
    ),
  )
  if (!current?.enabled || (current.expiresAt?.getTime() ?? Infinity) <= Date.now()) {
    throw invalidToken("API key is unavailable")
  }

  return {
    organization: { id: initial.organizationId },
    tenantUser,
  }
}

export async function verifyChatToken(
  token: string,
  verifier: Uint8Array,
  apiKeyId: string,
): Promise<ChatTenantUser> {
  try {
    const { organizationSlug } = parseApiKeyId(apiKeyId)
    const { payload, protectedHeader } = await jwtVerify(token, verifier, {
      algorithms: ["HS256"],
      typ: CHAT_TOKEN_TYPE,
      issuer: organizationSlug,
      audience: CHAT_TOKEN_AUDIENCE,
      requiredClaims: ["iat", "exp", "iss", "aud"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: CHAT_TOKEN_MAX_LIFETIME_SECONDS,
    })
    if (protectedHeader.kid !== apiKeyId) throw invalidToken("Wrong API key identifier")
    const identity = { user: payload.user, tenant: payload.tenant }
    if (textEncoder.encode(JSON.stringify(identity)).byteLength > CHAT_TOKEN_IDENTITY_MAX_BYTES) {
      throw invalidToken("Invalid user or tenant claims")
    }
    const claims = decodeChatTokenPayload(payload)
    if (
      claims.exp <= claims.iat ||
      claims.exp - claims.iat < CHAT_TOKEN_MIN_LIFETIME_SECONDS ||
      claims.exp - claims.iat > CHAT_TOKEN_MAX_LIFETIME_SECONDS
    ) {
      throw invalidToken("Invalid chat token claims")
    }
    return { ...claims.user, tenant: claims.tenant }
  } catch (cause) {
    if (isChatAuthenticationError(cause)) throw cause
    throw invalidToken("Invalid chat bearer token", cause)
  }
}

function parseApiKeyId(apiKeyId: string): { organizationSlug: string; keySlug: string } {
  const publicId = decodeApiKeyId(apiKeyId)
  if (Option.isNone(publicId)) throw invalidToken("Malformed API key identifier")
  const [, organizationSlug, , keySlug] = publicId.value
  return { organizationSlug, keySlug }
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization")
  const match = authorization && /^Bearer (\S+)$/i.exec(authorization)
  if (!match?.[1] || match[1].length > CHAT_TOKEN_MAX_LENGTH) {
    throw invalidToken("Malformed bearer token")
  }
  return match[1]
}

function invalidToken(message: string, cause?: unknown): ChatAuthenticationError {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return Object.assign(error, { code: "invalid_token" as const })
}
