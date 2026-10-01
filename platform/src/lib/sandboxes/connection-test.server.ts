import type { SandboxHandle } from "@tanstack/ai-sandbox"
import { Cause, DateTime, Effect, Exit, Predicate, Schema } from "effect"

import { createSandboxProvider } from "./factory.server.ts"
import type {
  SandboxConnectionErrorCode,
  SandboxProviderId,
  SandboxTestMetadata,
} from "./schemas.ts"

type SandboxTestAction = "create-provider" | "create-sandbox" | "execute-test" | "destroy-sandbox"

/** A vendor call failed or timed out, carrying its cause only for classification. */
class SandboxOperationFailed extends Schema.TaggedError<SandboxOperationFailed>()(
  "SandboxOperationFailed",
  { cause: Schema.Defect() },
) {}

function sandboxOperation<A>(
  operation: (signal: AbortSignal) => Promise<A>,
  timeout: `${number} seconds`,
) {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => new SandboxOperationFailed({ cause }),
  }).pipe(
    Effect.timeout(timeout),
    Effect.catchTag("TimeoutError", (cause) => Effect.fail(new SandboxOperationFailed({ cause }))),
  )
}

const createSandbox = (provider: {
  create: (options: { signal: AbortSignal }) => Promise<SandboxHandle>
}) => sandboxOperation((signal) => provider.create({ signal }), "30 seconds")

const destroySandbox = (handle: SandboxHandle) =>
  sandboxOperation(() => handle.destroy(), "15 seconds")

const execSandboxTest = (handle: SandboxHandle) =>
  sandboxOperation(
    (signal) => handle.process.exec("printf sandbox-connection-ok", { signal }),
    "15 seconds",
  ).pipe(
    Effect.filterOrFail(
      (result) => result.exitCode === 0 && result.stdout === "sandbox-connection-ok",
      () => new SandboxOperationFailed({ cause: new Error("Sandbox connection command failed") }),
    ),
  )

/**
 * Creates a real sandbox, runs a harmless command, and removes the sandbox. Interruption still
 * destroys a created sandbox, and every outcome is a result, never a failure.
 */
export const runSandboxConnectionTest = Effect.fn("runSandboxConnectionTest")(function* (input: {
  readonly provider: SandboxProviderId
  readonly options: unknown
  readonly credentials: unknown
}) {
  const testedAt = DateTime.formatIso(yield* DateTime.now)
  const failed = (action: SandboxTestAction, cause: unknown, errorCode = sandboxErrorCode(cause)) =>
    Effect.logWarning("Sandbox connection test failed").pipe(
      Effect.annotateLogs({
        provider: input.provider,
        action,
        errorCode,
        errorType: errorType(cause),
      }),
      Effect.as<SandboxTestMetadata>({ status: "failure", testedAt, errorCode }),
    )
  const provider = yield* Effect.exit(createSandboxProvider(input.provider, input))
  if (Exit.isFailure(provider))
    return yield* failed("create-provider", Cause.squash(provider.cause))
  return yield* Effect.acquireUseRelease(
    // Interruptible, so the timeout and a disconnect can abort the vendor call itself.
    Effect.interruptible(createSandbox(provider.value)),
    Effect.fnUntraced(function* (handle) {
      const test = yield* Effect.exit(execSandboxTest(handle))
      const cleanup = yield* Effect.exit(destroySandbox(handle))
      if (Exit.isFailure(cleanup)) {
        return yield* failed("destroy-sandbox", Cause.squash(cleanup.cause), "cleanup_failed")
      }
      if (Exit.isFailure(test)) return yield* failed("execute-test", Cause.squash(test.cause))
      return { status: "success", testedAt } satisfies SandboxTestMetadata
    }),
    // The use step destroys the sandbox itself, so this only runs when it was interrupted.
    (handle, exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.ignore(destroySandbox(handle))),
  ).pipe(Effect.catch((cause) => failed("create-sandbox", cause)))
})

function errorType(cause: unknown): string {
  const error = cause instanceof SandboxOperationFailed ? cause.cause : cause
  if (Predicate.isTagged(error, "TimeoutError")) return "TimeoutError"
  return error instanceof Error ? error.name : "UnknownError"
}

function sandboxErrorCode(cause: unknown): SandboxConnectionErrorCode {
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
