import { getRequest } from "@tanstack/react-start/server"
import { APIError } from "better-auth/api"

import {
  AUTH_EMAIL_DELIVERY_FAILED_CODE,
  AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
} from "@/lib/auth/email-delivery"

/**
 * Better Auth routes most sends through `runInBackgroundOrAwait`, which awaits the callback but
 * logs and swallows its rejection, so a throw inside `sendVerificationEmail` cannot reach the
 * client on its own. A failed blocking send is recorded against the current request here, and
 * `assertAuthEmailDelivered` rethrows it from the `after` hook as the response. Endpoints that
 * already rethrow the callback's error, such as `/send-verification-email`, get the same
 * `APIError` directly.
 * https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/context/create-context.ts
 */
const failedAuthEmailRequests = new WeakMap<Request, APIError>()

function currentAuthEmailRequest(): Request | null {
  try {
    return getRequest()
  } catch {
    // Auth CLI calls and direct server API calls can run outside TanStack's request context.
    return null
  }
}

function authEmailDeliveryError(): APIError {
  // 503 rather than 500: the provider is an unavailable upstream dependency and the caller can
  // retry. The body carries a stable code so the browser can render delivery-specific copy, and
  // a fixed message so the provider's own reason stays in the server log.
  return APIError.from("SERVICE_UNAVAILABLE", {
    code: AUTH_EMAIL_DELIVERY_FAILED_CODE,
    message: AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
  })
}

/**
 * Awaits an authentication email the caller is waiting on, so the response reports the outcome
 * instead of completing while delivery fails out of band.
 */
export async function deliverBlockingAuthEmail(send: () => Promise<void>): Promise<void> {
  try {
    await send()
  } catch {
    // The send boundary already logged the provider's reason against the masked recipient.
    const error = authEmailDeliveryError()
    const request = currentAuthEmailRequest()
    if (request) failedAuthEmailRequests.set(request, error)
    throw error
  }
}

/** Fails the response when a blocking authentication email could not be delivered. */
export function assertAuthEmailDelivered(): void {
  const request = currentAuthEmailRequest()
  if (!request) return
  const error = failedAuthEmailRequests.get(request)
  if (!error) return
  failedAuthEmailRequests.delete(request)
  throw error
}
