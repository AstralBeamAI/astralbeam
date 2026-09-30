import { createHmac } from "node:crypto"

import { Clock, Effect, Option, Schema } from "effect"
import { jwtVerify, SignJWT } from "jose"

import { getActiveDatabaseEncryptionRoot } from "@/db/lib/database-credentials.server"
import { generateSecret } from "@/lib/utils.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"

const OPERATOR_SESSION_COOKIE = "operator_session"
const OPERATOR_SESSION_TTL_SECONDS = 15 * 60
const OPERATOR_SESSION_MAX_TOKEN_LENGTH = 2_048
const OPERATOR_SESSION_ISSUER = "configure"
const OPERATOR_SESSION_AUDIENCE = "configure"
const OPERATOR_SESSION_SUBJECT = "operator"
const OPERATOR_SESSION_TYPE = "operator-session+jwt"

const decodeOperatorSessionClaims = Schema.decodeUnknownEffect(
  Schema.Struct({
    sub: Schema.Literal(OPERATOR_SESSION_SUBJECT),
    iat: Schema.Int,
    exp: Schema.Int,
  }).check(Schema.makeFilter((claims) => claims.exp - claims.iat === OPERATOR_SESSION_TTL_SECONDS)),
)

interface OperatorSession {
  expiresAt: Date
}

function operatorSessionSigningKey(encryptionRoot: Uint8Array): Uint8Array {
  return createHmac("sha256", encryptionRoot)
    .update("configure-operator-session-signing-key:v1\0")
    .digest()
}

/** A short, stateless session signed only by the first active `DATABASE_ENCRYPTION_KEY` value. */
export const createOperatorSession = Effect.fnUntraced(function* (
  encryptionRoot: Uint8Array = getActiveDatabaseEncryptionRoot(),
) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1_000)
  return yield* Effect.tryPromise(() =>
    new SignJWT()
      .setProtectedHeader({ alg: "HS256", typ: OPERATOR_SESSION_TYPE })
      .setIssuer(OPERATOR_SESSION_ISSUER)
      .setAudience(OPERATOR_SESSION_AUDIENCE)
      .setSubject(OPERATOR_SESSION_SUBJECT)
      .setJti(generateSecret())
      .setIssuedAt(now)
      .setExpirationTime(now + OPERATOR_SESSION_TTL_SECONDS)
      .sign(operatorSessionSigningKey(encryptionRoot)),
  ).pipe(Effect.orDie)
})

/** `None` for a missing, tampered, expired, or foreign token alike. */
export const verifyOperatorSession = Effect.fnUntraced(function* (
  token: string | undefined,
  encryptionRoot: Uint8Array = getActiveDatabaseEncryptionRoot(),
) {
  if (!token || token.length > OPERATOR_SESSION_MAX_TOKEN_LENGTH) return Option.none()
  const currentDate = new Date(yield* Clock.currentTimeMillis)
  return yield* Effect.tryPromise(() =>
    jwtVerify(token, operatorSessionSigningKey(encryptionRoot), {
      algorithms: ["HS256"],
      issuer: OPERATOR_SESSION_ISSUER,
      audience: OPERATOR_SESSION_AUDIENCE,
      requiredClaims: ["iat", "exp", "sub", "jti"],
      maxTokenAge: OPERATOR_SESSION_TTL_SECONDS,
      currentDate,
    }),
  ).pipe(
    Effect.filterOrFail((result) => result.protectedHeader.typ === OPERATOR_SESSION_TYPE),
    Effect.flatMap((result) => decodeOperatorSessionClaims(result.payload)),
    Effect.map((claims): OperatorSession => ({ expiresAt: new Date(claims.exp * 1_000) })),
    Effect.option,
  )
})

export const setOperatorSessionCookie = Effect.fn("setOperatorSessionCookie")(function* (
  token: string,
) {
  const server = yield* ServerRequest
  yield* server.setCookie(OPERATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_SECONDS,
    secure: import.meta.env.PROD,
  })
})

export const clearOperatorSessionCookie = Effect.fn("clearOperatorSessionCookie")(function* () {
  const server = yield* ServerRequest
  yield* server.deleteCookie(OPERATOR_SESSION_COOKIE, { path: "/", secure: import.meta.env.PROD })
})

/** The session the request's cookie carries, when it verifies. */
export const readOperatorSession = Effect.fn("readOperatorSession")(function* () {
  const server = yield* ServerRequest
  return yield* verifyOperatorSession(server.cookie(OPERATOR_SESSION_COOKIE))
})
