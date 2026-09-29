import { Cause, Context, Effect, Predicate } from "effect"

import { sqlConstraint, sqlState } from "@/db/lib/sqlstate.server"

const STACK_FRAME_LIMIT = 8

interface ReasonDiagnostic {
  readonly kind: "failure" | "defect" | "interruption"
  readonly type?: string | undefined
  readonly sqlstate?: string | undefined
  readonly constraint?: string | undefined
  readonly spans?: readonly string[] | undefined
  readonly stack?: readonly string[] | undefined
}

/**
 * Logs an unexposed failure once, with each reason's type, SQLSTATE, span trail and application
 * frames, never its message, which can carry SQL parameters or secrets. Returns the reference.
 */
export const reportFailure = Effect.fn("reportFailure")(function* (
  operation: string,
  cause: Cause.Cause<unknown>,
) {
  const referenceId = crypto.randomUUID().slice(0, 8)
  yield* Effect.logError("Request failed").pipe(
    Effect.annotateLogs({ operation, referenceId, reasons: cause.reasons.map(describeReason) }),
  )
  return referenceId
})

function describeReason(reason: Cause.Reason<unknown>): ReasonDiagnostic {
  if (Cause.isInterruptReason(reason)) return { kind: "interruption" }
  const value = Cause.isFailReason(reason) ? reason.error : reason.defect
  return {
    kind: Cause.isFailReason(reason) ? "failure" : "defect",
    type: errorType(value),
    sqlstate: sqlState(value),
    constraint: sqlConstraint(value),
    spans: spanTrail(reason),
    stack: Cause.isDieReason(reason) ? applicationFrames(value) : undefined,
  }
}

function errorType(value: unknown): string {
  if (Predicate.hasProperty(value, "_tag") && Predicate.isString(value._tag)) return value._tag
  return value instanceof Error ? value.name : typeof value
}

/** The `Effect.fn` spans the failure passed through, innermost first, with their call sites. */
function spanTrail(reason: Cause.Reason<unknown>): readonly string[] | undefined {
  const trail: string[] = []
  let frame = Context.getOrUndefined(Cause.reasonAnnotations(reason), Cause.StackTrace)
  for (; frame && trail.length < STACK_FRAME_LIMIT; frame = frame.parent) {
    const site = frame.stack()?.split("\n").find((line) => line.trim().startsWith("at "))
    const location = site && /\(([^()]*)\)$|at (\S+)$/.exec(site.trim())
    trail.push(location ? `${frame.name} (${location[1] ?? location[2]})` : frame.name)
  }
  return trail.length > 0 ? trail : undefined
}

// A stack's first line repeats the message, and library frames rarely locate the fault.
function applicationFrames(value: unknown): readonly string[] | undefined {
  if (!(value instanceof Error) || !value.stack) return undefined
  const frames = value.stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") && !line.includes("/node_modules/"))
    .slice(0, STACK_FRAME_LIMIT)
  return frames.length > 0 ? frames : undefined
}
