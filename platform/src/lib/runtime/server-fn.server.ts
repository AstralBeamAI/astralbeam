import { redirect } from "@tanstack/react-router"
import { setResponseStatus } from "@tanstack/react-start/server"
import { Cause, Data, Effect, Exit, type ManagedRuntime, Option } from "effect"

import { reportFailure } from "./failure-report.server.ts"
import { serverLoggerLayer } from "./logging.server.ts"
import { declaredHttpApiStatus } from "./http-api-status.ts"
import { type AppServices, getAppRuntime } from "./runtime.server.ts"
import { INTERNAL_ERROR_TAG } from "./server-fn-error.ts"
import { captureServerRequest, ServerRedirect, ServerRequest } from "./server-request.server.ts"
import { withActiveSpan } from "./tracing-context.server.ts"

/** A failure a server function chose to show, carrying its original tag and user-safe message. */
class ExposedError extends Data.TaggedError("ExposedError")<{
  readonly message: string
  readonly status: number
}> {}

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
      message: `[${error._tag}] ${error.message}`,
      status: declaredHttpApiStatus(error) ?? 400,
    }),
  )
}

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
  return runServerFnEffect(Effect, Effect.provide(effect, serverLoggerLayer), operation)
}

async function runServerFnEffect<A, E, R>(
  runtime: Pick<ManagedRuntime.ManagedRuntime<R, never>, "runPromiseExit">,
  effect: Effect.Effect<A, E, R | ServerRequest>,
  operation: string,
): Promise<A> {
  const request = captureServerRequest()
  const annotations = { requestId: request.request.headers.get("x-request-id"), operation }
  const exit = await runtime.runPromiseExit(
    withActiveSpan(Effect.provideService(effect, ServerRequest, request)).pipe(
      Effect.annotateLogs(annotations),
    ),
    { signal: request.request.signal },
  )
  if (Exit.isSuccess(exit)) return exit.value
  // Preserve request cancellation without treating internal interruptions as client aborts.
  if (Cause.hasInterruptsOnly(exit.cause)) request.request.signal.throwIfAborted()
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure) && !Cause.hasDies(exit.cause)) {
    if (failure.value instanceof ServerRedirect) {
      throw redirect({ href: failure.value.href, statusCode: failure.value.status })
    }
    if (failure.value instanceof ExposedError) {
      setResponseStatus(failure.value.status)
      throw failure.value
    }
  }
  // Report without the app runtime so service-initialization failures still receive a reference.
  const referenceId = Effect.runSync(
    reportFailure(operation, exit.cause).pipe(
      Effect.annotateLogs(annotations),
      Effect.provide(serverLoggerLayer),
    ),
  )
  setResponseStatus(500)
  throw new Error(`[${INTERNAL_ERROR_TAG}] Something went wrong. Reference: ${referenceId}`)
}

/** Runs a server route's Effect with its request. The route answers every outcome itself. */
export function runRouteEffect<A>(
  effect: Effect.Effect<A, never, AppServices | ServerRequest>,
): Promise<A> {
  const request = captureServerRequest()
  return getAppRuntime().runPromise(
    withActiveSpan(Effect.provideService(effect, ServerRequest, request)).pipe(
      Effect.annotateLogs({ requestId: request.request.headers.get("x-request-id") }),
    ),
    { signal: request.request.signal },
  )
}
