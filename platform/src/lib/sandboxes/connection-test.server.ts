import type { SandboxHandle } from "@tanstack/ai-sandbox"
import { Cause, DateTime, Effect, Exit, Predicate } from "effect"

import { SandboxResources } from "./resources.server"
import { SandboxOperationFailed } from "./errors"
import { sandboxCall, sandboxErrorCode } from "./operations.server"
import type { SandboxProviderId, SandboxTestMetadata } from "./schemas.ts"

type SandboxTestAction = "create-provider" | "create-sandbox" | "execute-test" | "destroy-sandbox"

const createSandbox = (provider: {
  create: (options: { signal: AbortSignal }) => Promise<SandboxHandle>
}) => {
  let pending: Promise<SandboxHandle> | undefined
  // Docker's create ignores the signal, so a timed-out or interrupted create destroys a late handle.
  return sandboxCall((signal) => (pending = provider.create({ signal })), "30 seconds").pipe(
    Effect.onError(() =>
      Effect.sync(() => void pending?.then((handle) => handle.destroy()).catch(() => undefined)),
    ),
  )
}

const destroySandbox = (handle: SandboxHandle) => sandboxCall(() => handle.destroy(), "15 seconds")

const execSandboxTest = (handle: SandboxHandle) =>
  sandboxCall(
    (signal) => handle.process.exec("printf sandbox-connection-ok", { signal }),
    "15 seconds",
  ).pipe(
    Effect.filterOrFail(
      (result) => result.exitCode === 0 && result.stdout === "sandbox-connection-ok",
      () =>
        new SandboxOperationFailed({
          timedOut: false,
          cause: new Error("Sandbox connection command failed"),
        }),
    ),
  )

/**
 * Creates a real sandbox, runs a harmless command, and removes the sandbox. Interruption still
 * destroys a created sandbox, and every outcome is a result, never a failure.
 */
export const runSandboxConnectionTest = Effect.fn("runSandboxConnectionTest")(function* (input: {
  readonly provider: SandboxProviderId
  readonly organizationId: string
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
  const resources = yield* SandboxResources
  const provider = yield* Effect.exit(resources.provider(input))
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
