import { redirect } from "@tanstack/react-router"
import { setResponseStatus } from "@tanstack/react-start/server"
import { Cause, Effect, Exit, type ManagedRuntime, Option, Schema } from "effect"

import { reportFailure } from "./failure-report.server.ts"
import { declaredHttpApiStatus } from "./http-api-status.ts"
import { type AppServices, getAppRuntime } from "./runtime.server.ts"
import { formatServerFnError, INTERNAL_ERROR_TAG } from "./server-fn-error.ts"
import { captureServerRequest, ServerRedirect, ServerRequest } from "./server-request.server.ts"

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
    new ExposedError({
      tag: error._tag,
      message: error.message,
      status: declaredHttpApiStatus(error) ?? 400,
    }),
  )
}

type ServerFnRuntime<R> = Pick<
  ManagedRuntime.ManagedRuntime<R, never>,
  "runPromise" | "runPromiseExit"
>

/**
 * Runs an Effect for a server function or its middleware. Exposed failures throw
 * `[Tag] message`, and every other failure is logged once and thrown with a reference.
 */
export function runEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices | ServerRequest>,
  operation: string,
): Promise<A> {
  return runServerFnEffect(getAppRuntime(), effect, operation)
}

/** Like `runEffect` for an Effect that needs only its request, while the app runtime cannot start. */
export function runRequestEffect<A, E>(
  effect: Effect.Effect<A, E, ServerRequest>,
  operation: string,
): Promise<A> {
  return runServerFnEffect(Effect, effect, operation)
}

async function runServerFnEffect<A, E, R>(
  runtime: ServerFnRuntime<R>,
  effect: Effect.Effect<A, E, R | ServerRequest>,
  operation: string,
): Promise<A> {
  const request = captureServerRequest()
  const exit = await runtime.runPromiseExit(Effect.provideService(effect, ServerRequest, request), {
    signal: request.request.signal,
  })
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure) && !Cause.hasDies(exit.cause)) {
    if (failure.value instanceof ServerRedirect) {
      throw redirect({ href: failure.value.href, statusCode: failure.value.status })
    }
    if (failure.value instanceof ExposedError) {
      setResponseStatus(failure.value.status)
      throw new Error(formatServerFnError(failure.value))
    }
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

/** Runs a server route's Effect with its request. The route answers every outcome itself. */
export function runRouteEffect<A>(
  effect: Effect.Effect<A, never, AppServices | ServerRequest>,
): Promise<A> {
  const request = captureServerRequest()
  return getAppRuntime().runPromise(Effect.provideService(effect, ServerRequest, request), {
    signal: request.request.signal,
  })
}
