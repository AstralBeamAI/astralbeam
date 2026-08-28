// Drizzle wraps driver failures in DrizzleQueryError, so the PostgreSQL code sits on a cause.
export function getPostgresErrorCode(error: unknown): string | undefined {
  let current = error
  while (typeof current === "object" && current !== null) {
    const code = (current as { code?: unknown }).code
    if (typeof code === "string") return code
    current = (current as { cause?: unknown }).cause
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
