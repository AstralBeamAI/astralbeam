import { SandboxCheckError } from "@astralbeam/sandbox"
import { Cause, DateTime, Effect, Predicate } from "effect"

import { createSandboxProvider } from "./factory.server.ts"
import type {
  SandboxConnectionErrorCode,
  SandboxProviderCredentials,
  SandboxProviderId,
  SandboxProviderOptions,
  SandboxTestMetadata,
} from "./schemas.ts"

export const runSandboxConnectionTest = Effect.fn("runSandboxConnectionTest")(function* (input: {
  readonly provider: SandboxProviderId
  readonly options: SandboxProviderOptions[SandboxProviderId]
  readonly credentials: SandboxProviderCredentials[SandboxProviderId]
}) {
  const testedAt = DateTime.formatIso(yield* DateTime.now)
  return yield* createSandboxProvider(input.provider, input).pipe(
    Effect.flatMap((provider) => {
      let checking: Promise<true> | undefined
      return Effect.tryPromise((signal) => (checking = provider.valid({ signal }))).pipe(
        Effect.onInterrupt(() =>
          Effect.promise(async () => {
            await checking?.catch(() => undefined)
          }),
        ),
      )
    }),
    Effect.as<SandboxTestMetadata>({ status: "success", testedAt }),
    Effect.catch((failure) => {
      const cause = Cause.isUnknownError(failure) ? failure.cause : failure
      const errorCode =
        cause instanceof SandboxCheckError && cause.action === "destroy-sandbox"
          ? "cleanup_failed"
          : sandboxErrorCode(cause)
      return Effect.logWarning("Sandbox connection test failed").pipe(
        Effect.annotateLogs({
          provider: input.provider,
          action: cause instanceof SandboxCheckError ? cause.action : "create-provider",
          errorCode,
          errorType: errorType(cause),
        }),
        Effect.as<SandboxTestMetadata>({ status: "failure", testedAt, errorCode }),
      )
    }),
  )
})

function errorType(cause: unknown): string {
  const error = cause instanceof SandboxCheckError ? cause.cause : cause
  if (Predicate.isTagged(error, "TimeoutError")) return "TimeoutError"
  return error instanceof Error ? error.name : "UnknownError"
}

function sandboxErrorCode(cause: unknown): SandboxConnectionErrorCode {
  const error = cause instanceof SandboxCheckError ? cause.cause : cause
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
