import { Cause, Effect, Predicate } from "effect"

export function sqlState(error: unknown): string | undefined {
  return postgresErrorField(error, "code")
}

export function sqlConstraint(error: unknown): string | undefined {
  return postgresErrorField(error, "constraint")
}

type DatabaseFailure = { readonly _tag: "EffectDrizzleQueryError" | "SqlError" }

/**
 * Fails with the domain error mapped to the violated constraint. Every other database failure is
 * a defect, so service interfaces carry only domain errors.
 */
export function mapDatabaseErrors<
  const Constraints extends Readonly<Record<string, () => unknown>> = {},
>(constraints: Constraints = {} as Constraints) {
  type Mapped = ReturnType<Constraints[keyof Constraints]>
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.catchIf(
      effect,
      (error): error is Extract<E, DatabaseFailure> =>
        Predicate.isTagged(error, "EffectDrizzleQueryError") ||
        Predicate.isTagged(error, "SqlError"),
      (error) => {
        const constraint = sqlConstraint(error)
        const mapped = constraint === undefined ? undefined : constraints[constraint]
        return mapped ? Effect.fail(mapped() as Mapped) : Effect.die(error)
      },
      Effect.fail,
    )
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
