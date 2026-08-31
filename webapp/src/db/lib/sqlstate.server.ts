import * as Cause from "effect/Cause"

export function sqlState(error: unknown): string | undefined {
  const visited = new Set<object>()
  while (typeof error === "object" && error !== null && !visited.has(error)) {
    visited.add(error)
    if ("code" in error && typeof error.code === "string") return error.code
    error = Cause.isCause(error) ? Cause.squash(error) : "cause" in error ? error.cause : undefined
  }
  return undefined
}
