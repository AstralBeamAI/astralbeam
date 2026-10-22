import { type Duration, Effect } from "effect"

import { errorReason } from "@/lib/runtime/failure-report.server"
import { ChatSandboxOperationFailed } from "./errors"

/** Wraps one vendor sandbox call: a timeout interrupts it, and its error never reaches the agent. */
export function chatSandboxCall<A>(
  call: (signal: AbortSignal) => PromiseLike<A>,
  timeout: Duration.Input,
) {
  return Effect.tryPromise({
    try: call,
    catch: (cause) => new ChatSandboxOperationFailed({ timedOut: false, cause }),
  }).pipe(
    Effect.timeout(timeout),
    Effect.catchTag("TimeoutError", (cause) =>
      Effect.fail(new ChatSandboxOperationFailed({ timedOut: true, cause })),
    ),
  )
}

/** Logs why a sandbox call failed with its vendor code or type only. */
export function logChatSandboxFailure(operation: string, error: ChatSandboxOperationFailed) {
  return Effect.logWarning("Chat sandbox operation failed").pipe(
    Effect.annotateLogs({ operation, timedOut: error.timedOut, reason: errorReason(error.cause) }),
  )
}
