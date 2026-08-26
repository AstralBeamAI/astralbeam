import { getRequest } from "@tanstack/react-start/server"
import { APIError } from "better-auth/api"

/**
 * Better Auth routes every send through `runInBackgroundOrAwait`, which logs a rejection and
 * swallows it, so a throw inside `sendVerificationEmail` never reaches the client. Blocking sends
 * record their failure against the current request here, and `assertAuthEmailDelivered` turns it
 * into an error response from the `after` hook.
 */
const failedAuthEmailRequests = new WeakSet<Request>()

const AUTH_EMAIL_FAILURE_MESSAGE =
  "We could not send the email. Please try again in a few minutes, or contact support if it keeps failing."

function currentAuthEmailRequest(): Request | null {
  try {
    return getRequest()
  } catch {
    // Auth CLI calls and direct server API calls can run outside TanStack's request context.
    return null
  }
}

/**
 * Awaits an authentication email the caller is waiting on, so the response reports the outcome
 * instead of completing while delivery fails out of band.
 */
export async function deliverBlockingAuthEmail(send: () => Promise<void>): Promise<void> {
  try {
    await send()
  } catch (error) {
    const request = currentAuthEmailRequest()
    if (request) failedAuthEmailRequests.add(request)
    throw error
  }
}

/** Fails the response when a blocking authentication email could not be delivered. */
export function assertAuthEmailDelivered(): void {
  const request = currentAuthEmailRequest()
  if (!request || !failedAuthEmailRequests.has(request)) return
  failedAuthEmailRequests.delete(request)
  // No `code`: Better Auth UI prefers a localized string for a known code and would otherwise
  // show the raw identifier, while `message` is rendered as written.
  throw new APIError("INTERNAL_SERVER_ERROR", { message: AUTH_EMAIL_FAILURE_MESSAGE })
}
