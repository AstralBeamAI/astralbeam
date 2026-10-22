import { Cause, type Duration, Effect, Predicate } from "effect"

import { errorReason } from "@/lib/runtime/failure-report.server"
import { SandboxOperationFailed } from "./errors"
import type { SandboxConnectionErrorCode } from "./schemas"

/** Wraps one vendor sandbox call: a timeout interrupts it, and its error never reaches the agent. */
export function sandboxCall<A>(
  call: (signal: AbortSignal) => PromiseLike<A>,
  timeout: Duration.Input,
) {
  return Effect.tryPromise({
    try: call,
    catch: (cause) => new SandboxOperationFailed({ timedOut: false, cause }),
  }).pipe(
    Effect.timeout(timeout),
    Effect.catchTag("TimeoutError", (cause) =>
      Effect.fail(new SandboxOperationFailed({ timedOut: true, cause })),
    ),
  )
}

/** Logs why a sandbox call failed with its vendor code or type only. */
export function logSandboxFailure(operation: string, error: SandboxOperationFailed) {
  return Effect.logWarning("Sandbox operation failed").pipe(
    Effect.annotateLogs({ operation, timedOut: error.timedOut, reason: errorReason(error.cause) }),
  )
}

export function sandboxErrorCode(cause: unknown): SandboxConnectionErrorCode {
  const error = cause instanceof SandboxOperationFailed ? cause.cause : cause
  if (Cause.isTimeoutError(error)) return "timeout"
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
  if (!(error instanceof Error)) return "provider_error"
  let current: unknown = error
  const seen = new Set<unknown>()
  while (Predicate.isObject(current) && !seen.has(current)) {
    seen.add(current)
    // Vercel's APIError keeps the status on its `response`.
    const response = Predicate.hasProperty(current, "response") ? current.response : undefined
    const status = Predicate.hasProperty(current, "status")
      ? current.status
      : Predicate.hasProperty(current, "statusCode")
        ? current.statusCode
        : Predicate.hasProperty(response, "status")
          ? response.status
          : undefined
    if (status === 401 || status === 403) return "authentication"
    if (status === 404) return "not_found"
    if (status === 429) return "quota"
    current = Predicate.hasProperty(current, "cause") ? current.cause : undefined
  }
  // Sprites throws a plain Error naming the HTTP status, so read it from the message.
  // https://github.com/TanStack/ai/blob/main/packages/ai-sandbox-sprites/src/client.ts
  const httpStatus = / failed: (\d{3}) /.exec(error.message)?.[1]
  if (httpStatus === "401" || httpStatus === "403") return "authentication"
  if (httpStatus === "404") return "not_found"
  if (httpStatus === "429") return "quota"
  const code =
    Predicate.hasProperty(error, "code") && Predicate.isString(error.code) ? error.code : ""
  if (/timeout/i.test(error.name) || /timed?out/i.test(code)) return "timeout"
  if (/auth|token/i.test(error.name)) return "authentication"
  if (/quota|rate/i.test(error.name)) return "quota"
  if (/notfound/i.test(error.name)) return "not_found"
  if (/cleanup/i.test(error.name)) return "cleanup_failed"
  return "provider_error"
}
