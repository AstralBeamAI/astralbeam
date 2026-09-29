import { AsyncLocalStorage } from "node:async_hooks"

import { APIError } from "better-auth/api"
import { Effect } from "effect"

import {
  AUTH_EMAIL_DELIVERY_FAILED_CODE,
  AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
} from "@/lib/auth/email-delivery"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { tryPromiseInServerRequest } from "@/lib/runtime/server-request.server"
import { AuthEmailNotDelivered } from "./errors.ts"

// `runInBackgroundOrAwait` swallows a callback's rejection, so a failed send is recorded against its
// request and rethrown from the `after` hook. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/context/create-context.ts
const failedAuthEmailRequests = new WeakMap<Request, APIError>()
const blockingAuthEmailContext = new AsyncLocalStorage<{ error?: APIError }>()

/** Runs a requestless Better Auth server API call, failing when a blocking send failed. */
export const withBlockingAuthEmailDelivery = Effect.fnUntraced(function* <A>(
  operation: () => Promise<A>,
) {
  const scope: { error?: APIError } = {}
  const result = yield* tryPromiseInServerRequest(() =>
    blockingAuthEmailContext.run(scope, operation),
  ).pipe(
    Effect.catch((cause) =>
      scope.error ? Effect.fail(new AuthEmailNotDelivered()) : Effect.die(cause),
    ),
  )
  if (scope.error) return yield* new AuthEmailNotDelivered()
  return result
})

// 503 rather than 500: the provider is an unavailable upstream dependency and the caller can
// retry. The code lets the browser render delivery-specific copy, and the message stays fixed.
function authEmailDeliveryError(): APIError {
  return APIError.from("SERVICE_UNAVAILABLE", {
    code: AUTH_EMAIL_DELIVERY_FAILED_CODE,
    message: AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
  })
}

/** Awaits an email the caller is waiting on, so the response reports its outcome. `request` is the
 * one Better Auth passed to its callback, absent for requestless server API calls. */
export function deliverBlockingAuthEmail(
  request: Request | undefined,
  send: () => Promise<void>,
): Promise<void> {
  // Read before the fiber starts, which may resume in another request's async context.
  const scope = blockingAuthEmailContext.getStore()
  return runAppEffect(
    // The send boundary already logged the provider's reason against the masked recipient.
    Effect.tryPromise({ try: send, catch: authEmailDeliveryError }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (scope) scope.error = error
          if (request) failedAuthEmailRequests.set(request, error)
        }),
      ),
    ),
  )
}

/** Fails the response when a blocking authentication email could not be delivered. */
export function assertAuthEmailDelivered(request: Request | undefined): void {
  const error = request && failedAuthEmailRequests.get(request)
  if (!error) return
  failedAuthEmailRequests.delete(request)
  throw error
}
