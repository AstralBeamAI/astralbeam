import { Cause, Effect, Predicate } from "effect"
import { SpanStatusCode, trace } from "@opentelemetry/api"

/** Logs an unexposed failure's full cause once and returns its client reference. */
export const reportFailure = Effect.fnUntraced(function* (
  operation: string,
  cause: Cause.Cause<unknown>,
) {
  const referenceId = crypto.randomUUID().slice(0, 8)
  // Routine cancellation should not create an error report.
  if (Cause.hasInterruptsOnly(cause)) return referenceId
  const span = trace.getActiveSpan()
  if (span?.isRecording()) {
    const errors = Cause.prettyErrors(cause, { includeCauseInStack: true })
    for (const error of errors) span.recordException(error)
    span.setAttribute("error.type", errors[0]?.name ?? "unknown")
    span.setStatus({ code: SpanStatusCode.ERROR })
  }
  yield* Effect.logError("Request failed", cause).pipe(
    Effect.annotateLogs({
      event: "request.failed",
      operation,
      referenceId,
    }),
  )
  return referenceId
})

/** Returns a bounded vendor code or error name for classification. */
export function errorReason(error: unknown): string {
  const reason = (["code", "name"] as const)
    .map((field) => (Predicate.hasProperty(error, field) ? error[field] : undefined))
    .find(Predicate.isString)
  return reason && /^[\w.-]{1,64}$/.test(reason) ? reason : "unknown"
}
