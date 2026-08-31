import * as Cause from "effect/Cause"

// Drizzle stores Effect SQL failures in an Effect Cause; SQL errors then expose their reason as
// the standard JavaScript `cause`.
export function getPostgresErrorCode(error: unknown): string | undefined {
  let current = error
  const visited = new Set<object>()
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current)
    const code = "code" in current ? current.code : undefined
    if (typeof code === "string") return code
    current = Cause.isCause(current)
      ? Cause.squash(current)
      : "cause" in current
      ? current.cause
      : undefined
  }
  return undefined
}

export function hasPostgresErrorCode(error: unknown, codes: readonly string[]): boolean {
  const code = getPostgresErrorCode(error)
  return code !== undefined && codes.includes(code)
}

export function isMissingTableError(error: unknown): boolean {
  return hasPostgresErrorCode(error, ["42P01"])
}
