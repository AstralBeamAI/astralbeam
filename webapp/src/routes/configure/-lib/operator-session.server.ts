import { createHmac } from "node:crypto"

import { jwtVerify, SignJWT } from "jose"
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server"

import { getActiveDatabaseEncryptionRoot } from "@/db/lib/database-credentials.server"
import { generateSecret } from "@/lib/generate-secret.server"

const OPERATOR_SESSION_COOKIE = "operator_session"
const OPERATOR_SESSION_TTL_SECONDS = 15 * 60
const OPERATOR_SESSION_MAX_TOKEN_LENGTH = 2_048
const OPERATOR_SESSION_ISSUER = "configure"
const OPERATOR_SESSION_AUDIENCE = "configure"
const OPERATOR_SESSION_SUBJECT = "operator"
const OPERATOR_SESSION_TYPE = "operator-session+jwt"

interface OperatorSession {
  expiresAt: Date
}

function operatorSessionSigningKey(encryptionRoot: Uint8Array): Uint8Array {
  return createHmac("sha256", encryptionRoot)
    .update("configure-operator-session-signing-key:v1\0")
    .digest()
}

export async function createOperatorSession(
  encryptionRoot = getActiveDatabaseEncryptionRoot(),
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000)
  return await new SignJWT()
    .setProtectedHeader({ alg: "HS256", typ: OPERATOR_SESSION_TYPE })
    .setIssuer(OPERATOR_SESSION_ISSUER)
    .setAudience(OPERATOR_SESSION_AUDIENCE)
    .setSubject(OPERATOR_SESSION_SUBJECT)
    .setJti(generateSecret())
    .setIssuedAt(now)
    .setExpirationTime(now + OPERATOR_SESSION_TTL_SECONDS)
    .sign(operatorSessionSigningKey(encryptionRoot))
}

export async function verifyOperatorSession(
  token: string | undefined,
  encryptionRoot = getActiveDatabaseEncryptionRoot(),
): Promise<OperatorSession | null> {
  if (!token || token.length > OPERATOR_SESSION_MAX_TOKEN_LENGTH) return null
  try {
    const result = await jwtVerify(token, operatorSessionSigningKey(encryptionRoot), {
      algorithms: ["HS256"],
      issuer: OPERATOR_SESSION_ISSUER,
      audience: OPERATOR_SESSION_AUDIENCE,
      requiredClaims: ["iat", "exp", "sub", "jti"],
      maxTokenAge: OPERATOR_SESSION_TTL_SECONDS,
    })
    const { payload, protectedHeader } = result
    if (
      protectedHeader.typ !== OPERATOR_SESSION_TYPE ||
      payload.sub !== OPERATOR_SESSION_SUBJECT ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat !== OPERATOR_SESSION_TTL_SECONDS
    ) return null
    return { expiresAt: new Date(payload.exp * 1_000) }
  } catch {
    return null
  }
}

function operatorSessionToken(): string | undefined {
  return getCookie(OPERATOR_SESSION_COOKIE)
}

export function setOperatorSessionCookie(token: string): void {
  setCookie(OPERATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_SECONDS,
    secure: import.meta.env.PROD,
  })
}

export function clearOperatorSessionCookie(): void {
  deleteCookie(OPERATOR_SESSION_COOKIE, {
    path: "/",
    secure: import.meta.env.PROD,
  })
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  return await verifyOperatorSession(operatorSessionToken())
}
