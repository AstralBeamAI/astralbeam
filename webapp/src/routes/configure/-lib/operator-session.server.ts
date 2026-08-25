import { createHash, randomBytes } from "node:crypto"

import { and, eq, gt } from "drizzle-orm"
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server"

import { isMissingTableError } from "@/lib/config.server"
import { OPERATOR_SESSION_COOKIE, OPERATOR_SESSION_TTL_SECONDS } from "./constants.server"

export interface OperatorSession {
  dbUsername: string
}

// Bootstrap fallback: on a fresh database the config_session table does not exist until the first
// migration run, so sessions created before it are held in this instance's memory and promoted to
// the database as soon as the table appears.
const memorySessions = new Map<string, { dbUsername: string; expiresAt: number }>()

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function createOperatorSession(dbUsername: string): Promise<string> {
  const token = randomBytes(32).toString("base64url")
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + OPERATOR_SESSION_TTL_SECONDS * 1000)
  try {
    const { db } = await import("@/db/index.server")
    const { configSession } = await import("@/db/schema.server")
    await db.insert(configSession).values({ tokenHash, dbUsername, expiresAt })
  } catch (error) {
    if (!isMissingTableError(error)) throw error
    memorySessions.set(tokenHash, { dbUsername, expiresAt: expiresAt.getTime() })
  }
  return token
}

export async function verifyOperatorSession(
  token: string | undefined,
): Promise<OperatorSession | null> {
  if (!token) return null
  const tokenHash = hashToken(token)
  const memory = memorySessions.get(tokenHash)
  if (memory) {
    if (memory.expiresAt <= Date.now()) {
      memorySessions.delete(tokenHash)
      return null
    }
    await promoteMemorySessions()
    return { dbUsername: memory.dbUsername }
  }
  try {
    const { db } = await import("@/db/index.server")
    const { configSession } = await import("@/db/schema.server")
    const rows = await db
      .select({ dbUsername: configSession.dbUsername })
      .from(configSession)
      .where(and(
        eq(configSession.tokenHash, tokenHash),
        gt(configSession.expiresAt, new Date()),
      ))
    return rows[0] ?? null
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

// Once migrations create config_session, move bootstrap sessions into the database so any
// instance can verify them.
export async function promoteMemorySessions(): Promise<void> {
  if (memorySessions.size === 0) return
  try {
    const { db } = await import("@/db/index.server")
    const { configSession } = await import("@/db/schema.server")
    for (const [tokenHash, session] of memorySessions) {
      if (session.expiresAt > Date.now()) {
        await db
          .insert(configSession)
          .values({
            tokenHash,
            dbUsername: session.dbUsername,
            expiresAt: new Date(session.expiresAt),
          })
          .onConflictDoNothing()
      }
      memorySessions.delete(tokenHash)
    }
  } catch (error) {
    if (!isMissingTableError(error)) throw error
  }
}

export async function destroyOperatorSession(token: string | undefined): Promise<void> {
  if (!token) return
  const tokenHash = hashToken(token)
  memorySessions.delete(tokenHash)
  try {
    const { db } = await import("@/db/index.server")
    const { configSession } = await import("@/db/schema.server")
    await db.delete(configSession).where(eq(configSession.tokenHash, tokenHash))
  } catch (error) {
    if (!isMissingTableError(error)) throw error
  }
}

export function operatorSessionToken(): string | undefined {
  return getCookie(OPERATOR_SESSION_COOKIE)
}

export function setOperatorSessionCookie(token: string): void {
  setCookie(OPERATOR_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_SECONDS,
    // The base URL may not be configured yet, so infer HTTPS from the request itself.
    secure: new URL(getRequest().url).protocol === "https:",
  })
}

export function clearOperatorSessionCookie(): void {
  deleteCookie(OPERATOR_SESSION_COOKIE, { path: "/" })
}

// Every /configure server function calls this first and refuses to act without a session.
export async function getOperatorSession(): Promise<OperatorSession | null> {
  return await verifyOperatorSession(operatorSessionToken())
}
