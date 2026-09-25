import * as Cause from "effect/Cause"

export function sqlState(error: unknown): string | undefined {
  return postgresErrorField(error, "code")
}

export function sqlConstraint(error: unknown): string | undefined {
  return postgresErrorField(error, "constraint")
}

function postgresErrorField(error: unknown, field: "code" | "constraint"): string | undefined {
  const visited = new Set<object>()
  while (typeof error === "object" && error !== null && !visited.has(error)) {
    visited.add(error)
    const value = (error as Record<string, unknown>)[field]
    if (typeof value === "string") return value
    error = Cause.isCause(error) ? Cause.squash(error) : "cause" in error ? error.cause : undefined
  }
  return undefined
}
