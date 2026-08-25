import { createHash, timingSafeEqual } from "node:crypto"

import { DATABASE_URL } from "@/lib/config.server"

type OperatorCredentialCheck = "valid" | "invalid" | "no-password"

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

// Hashing first keeps the comparison constant-time across unequal lengths.
function secureEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

// Holding the deployment's database credentials is what authorizes an operator, so the submitted
// values are compared against DATABASE_URL instead of probing a separate database connection.
export function checkOperatorCredentials(
  username: string,
  password: string,
): OperatorCredentialCheck {
  const url = new URL(DATABASE_URL)
  if (!url.password) return "no-password"
  const usernameMatches = secureEquals(username, decodeURIComponent(url.username))
  const passwordMatches = secureEquals(password, decodeURIComponent(url.password))
  return usernameMatches && passwordMatches ? "valid" : "invalid"
}

// In-memory fixed-window throttle: login precedes any session, and the database-backed rate
// limiter may not exist yet on a fresh database.
const LOGIN_WINDOW_MS = 60_000
const LOGIN_MAX_FAILURES = 5
const LOGIN_SOURCE_LIMIT = 1_000

const loginFailures = new Map<string, { count: number; resetAt: number }>()

export function isLoginThrottled(source: string): boolean {
  const entry = loginFailures.get(source)
  return entry !== undefined && entry.resetAt > Date.now() && entry.count >= LOGIN_MAX_FAILURES
}

export function recordLoginFailure(source: string): void {
  const now = Date.now()
  if (loginFailures.size >= LOGIN_SOURCE_LIMIT) {
    for (const [key, entry] of loginFailures) {
      if (entry.resetAt <= now) loginFailures.delete(key)
    }
  }
  const entry = loginFailures.get(source)
  if (!entry || entry.resetAt <= now) {
    loginFailures.set(source, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  entry.count += 1
}
