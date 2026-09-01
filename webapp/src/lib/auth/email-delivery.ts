/**
 * Shared contract for a failed authentication email send. The code travels in the Better Auth
 * error body so the browser can tell a delivery outage apart from every other authentication
 * failure without the provider's own reason ever leaving the server.
 */
export const AUTH_EMAIL_DELIVERY_FAILED_CODE = "EMAIL_DELIVERY_FAILED"

/** Sentence shown when an authentication email could not be handed to the provider. */
export const AUTH_EMAIL_DELIVERY_FAILED_MESSAGE =
  "We could not send the email. Please try again in a few minutes, or contact support if it keeps failing."

/** True when a Better Auth response failed because the email could not be handed to the provider. */
export function isAuthEmailDeliveryError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const body = (error as { error?: unknown }).error
  if (typeof body !== "object" || body === null) return false
  return (body as { code?: unknown }).code === AUTH_EMAIL_DELIVERY_FAILED_CODE
}
