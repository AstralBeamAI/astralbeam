import type { SandboxHandle } from "@tanstack/ai-sandbox"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

import { createSandboxProvider } from "@/lib/sandbox/factory.server"
import type {
  SandboxConnectionErrorCode,
  SandboxProviderId,
  SandboxTestMetadata,
} from "@/lib/sandbox/schemas"

class OrganizationSandboxProviderOperationError extends Data.TaggedError(
  "OrganizationSandboxProviderOperationError",
)<{ readonly cause: unknown }> {}

export function runOrganizationSandboxConnectionTest(input: {
  provider: SandboxProviderId
  options: unknown
  credentials: unknown
}): Effect.Effect<SandboxTestMetadata> {
  return Effect.gen(function* () {
    const testedAt = new Date().toISOString()
    const providerExit = yield* Effect.exit(createSandboxProvider(input.provider, input))
    if (Exit.isFailure(providerExit)) {
      const error = Cause.squash(providerExit.cause)
      return failedOrganizationSandboxConnectionTest(
        testedAt,
        input.provider,
        "create-provider",
        sanitizeOrganizationSandboxProviderError(error),
        error,
      )
    }

    const provider = providerExit.value
    const handleExit = yield* Effect.exit(
      sandboxProviderPromiseEffect(() => provider.create({ signal: AbortSignal.timeout(30_000) })),
    )
    if (Exit.isFailure(handleExit)) {
      const error = Cause.squash(handleExit.cause)
      return failedOrganizationSandboxConnectionTest(
        testedAt,
        input.provider,
        "create-sandbox",
        sanitizeOrganizationSandboxProviderError(error),
        error,
      )
    }

    const handle = handleExit.value
    const useExit = yield* Effect.exit(testOrganizationSandboxHandle(handle))
    const cleanupExit = yield* Effect.exit(destroyOrganizationSandboxTestHandle(handle))
    if (Exit.isFailure(cleanupExit)) {
      return failedOrganizationSandboxConnectionTest(
        testedAt,
        input.provider,
        "destroy-sandbox",
        "cleanup_failed",
        Cause.squash(cleanupExit.cause),
      )
    }
    if (Exit.isFailure(useExit)) {
      const error = Cause.squash(useExit.cause)
      return failedOrganizationSandboxConnectionTest(
        testedAt,
        input.provider,
        "execute-test",
        sanitizeOrganizationSandboxProviderError(error),
        error,
      )
    }
    return { status: "success", testedAt }
  })
}

function testOrganizationSandboxHandle(
  handle: SandboxHandle,
): Effect.Effect<void, OrganizationSandboxProviderOperationError> {
  return sandboxProviderPromiseEffect(() =>
    handle.process.exec("printf sandbox-connection-ok", {
      signal: AbortSignal.timeout(15_000),
    })
  ).pipe(
    Effect.filterOrFail(
      (result) => result.exitCode === 0 && result.stdout === "sandbox-connection-ok",
      () =>
        new OrganizationSandboxProviderOperationError({
          cause: new Error("Sandbox connection command failed"),
        }),
    ),
    Effect.asVoid,
  )
}

function destroyOrganizationSandboxTestHandle(
  handle: SandboxHandle,
): Effect.Effect<void, OrganizationSandboxProviderOperationError> {
  return sandboxProviderPromiseEffect(() => handle.destroy()).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError((cause) =>
      cause instanceof OrganizationSandboxProviderOperationError
        ? cause
        : new OrganizationSandboxProviderOperationError({ cause })
    ),
  )
}

function sandboxProviderPromiseEffect<Value>(
  operation: () => Promise<Value>,
): Effect.Effect<Value, OrganizationSandboxProviderOperationError> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => new OrganizationSandboxProviderOperationError({ cause }),
  })
}

function failedOrganizationSandboxConnectionTest(
  testedAt: string,
  provider: SandboxProviderId,
  action: "create-provider" | "create-sandbox" | "execute-test" | "destroy-sandbox",
  errorCode: SandboxConnectionErrorCode,
  error: unknown,
): SandboxTestMetadata {
  console.error("Organization sandbox connection test failed", {
    provider,
    action,
    errorCode,
    errorName: error instanceof Error ? error.name : "UnknownError",
  })
  return { status: "failure", testedAt, errorCode }
}

function sanitizeOrganizationSandboxProviderError(
  error: unknown,
): SandboxConnectionErrorCode {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
  if (!(error instanceof Error)) return "provider_error"
  let current: unknown = error
  const seen = new Set<unknown>()
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current)
    const record = current as { status?: unknown; statusCode?: unknown; cause?: unknown }
    const status = record.status ?? record.statusCode
    if (status === 401 || status === 403) return "authentication"
    if (status === 404) return "not_found"
    if (status === 429) return "quota"
    current = record.cause
  }
  const errorCode = (error as Error & { code?: unknown }).code
  const code = typeof errorCode === "string" ? errorCode : ""
  if (/timeout/i.test(error.name) || /timed?out/i.test(code)) return "timeout"
  if (/auth|token/i.test(error.name)) return "authentication"
  if (/quota|rate/i.test(error.name)) return "quota"
  if (/notfound/i.test(error.name)) return "not_found"
  if (/cleanup/i.test(error.name)) return "cleanup_failed"
  return "provider_error"
}
