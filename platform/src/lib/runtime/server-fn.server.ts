import { getRequest, setResponseStatus } from "@tanstack/react-start/server"
import { Cause, Effect, Exit, Option, Predicate, Schema, SchemaAST } from "effect"

import { reportFailure } from "./failure-report.server.ts"
import { type AppServices, getAppRuntime } from "./runtime.server.ts"
import { formatServerFnError, INTERNAL_ERROR_TAG } from "./server-fn-error.ts"

/** A failure a server function chose to show, carrying its original tag and user-safe message. */
export class ExposedError extends Schema.TaggedError<ExposedError>()("ExposedError", {
  tag: Schema.String,
  message: Schema.String,
  status: Schema.Int,
}) {}

/**
 * Marks a typed failure as safe to show the caller. Use it with `Effect.catchTag`, which checks
 * each listed tag against the Effect's own failures.
 */
export function exposeError(error: {
  readonly _tag: string
  readonly message: string
}): Effect.Effect<never, ExposedError> {
  return Effect.fail(
    new ExposedError({ tag: error._tag, message: error.message, status: httpStatus(error) }),
  )
}

/**
 * Runs an Effect for a server function or its middleware. Exposed failures throw
 * `[Tag] message`, and every other failure is logged once and thrown with a reference.
 */
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  operation: string,
): Promise<A> {
  const runtime = getAppRuntime()
  const exit = await runtime.runPromiseExit(effect, { signal: getRequest().signal })
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (
    Option.isSome(failure) &&
    failure.value instanceof ExposedError &&
    !Cause.hasDies(exit.cause)
  ) {
    setResponseStatus(failure.value.status)
    throw new Error(formatServerFnError(failure.value))
  }
  const referenceId = await runtime.runPromise(reportFailure(operation, exit.cause))
  setResponseStatus(500)
  throw new Error(
    formatServerFnError({
      tag: INTERNAL_ERROR_TAG,
      message: `Something went wrong. Reference: ${referenceId}`,
    }),
  )
}

// Reuses the status an error class declares for HttpApi, so both transports agree.
export function httpStatus(error: object): number {
  const errorClass: unknown = error.constructor
  const ast = Predicate.hasProperty(errorClass, "ast") ? errorClass.ast : undefined
  return (SchemaAST.isAST(ast) && SchemaAST.resolveAt<number>("httpApiStatus")(ast)) || 400
}
