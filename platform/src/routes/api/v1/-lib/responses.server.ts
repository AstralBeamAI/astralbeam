import { Duration, Effect } from "effect"
import type { RateLimiter } from "effect/unstable/persistence"
import { ChatError } from "../../../../lib/chat/errors.server.ts"
import { RestProblem } from "./shared.server"

// Transitional adapters for the chat handlers, which still fail with untyped errors. Delete them
// once chat declares its own error classes with `httpApiStatus`.

export function restFault(status: number, detail: string): RestProblem {
  return new RestProblem({ status, message: detail })
}

export function restRateLimitFault(error: RateLimiter.RateLimiterError): RestProblem {
  return error.reason._tag === "RateLimitExceeded"
    ? new RestProblem({
        status: 429,
        message: "Request limit exceeded.",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(Duration.toMillis(error.reason.retryAfter) / 1000),
        ),
      })
    : new RestProblem({ status: 500, message: "Request limit could not be checked." })
}

const chatErrorStatus = { InvalidInput: 400, NotFound: 404, Unavailable: 503 } as const

/** Keeps problem and chat failures typed, and leaves every other failure for the boundary. */
export function restHandleErrors(_operation: string) {
  return Effect.catch((error: unknown) =>
    error instanceof RestProblem
      ? Effect.fail(error)
      : error instanceof ChatError
        ? Effect.fail(restFault(chatErrorStatus[error.reason], error.message))
        : Effect.die(error),
  )
}
