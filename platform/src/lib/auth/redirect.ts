import { getSafeRedirectTo } from "@better-auth-ui/core"
import { AUTH_ALLOWED_RETURN_PATHS, INERT_REDIRECT_ORIGIN } from "../constants.ts"

// Invitation link hints only prefill the form. Better Auth verifies the signed-in recipient.
export function getInvitationContext(redirectTo: string) {
  const path = normalizeReturnPath(redirectTo, INERT_REDIRECT_ORIGIN, AUTH_ALLOWED_RETURN_PATHS)
  const url = new URL(path, INERT_REDIRECT_ORIGIN)
  if (url.pathname !== "/auth/accept-invitation" || !url.searchParams.get("invitationId")) return
  return {
    email: url.searchParams.get("email") ?? "",
    organization: url.searchParams.get("organization") || "your organization",
  }
}

/** Accept only network browser origins; opaque SSR origins serialize as `null`. https://url.spec.whatwg.org/#origin */
export function resolveRedirectOrigin(
  location: { origin?: unknown } | null | undefined,
  fallback: string,
): string {
  if (typeof location?.origin !== "string") return fallback

  try {
    const origin = new URL(location.origin)
    return origin.protocol === "http:" || origin.protocol === "https:" ? origin.origin : fallback
  } catch {
    return fallback
  }
}

/**
 * Layer the application's reserved-route policy on Better Auth UI's same-origin
 * redirect normalizer. https://better-auth-ui.com/docs/shadcn/integrations/tanstack-start
 */
export function normalizeReturnPath(
  value: unknown,
  origin: string,
  allowedAuthPaths: readonly string[] = [],
): string {
  if (typeof value !== "string") return "/"

  const safePath = getSafeRedirectTo(value, origin)
  const url = new URL(safePath, origin)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname).toLowerCase()
  } catch {
    return "/"
  }

  const isAllowedAuthPath = allowedAuthPaths.includes(url.pathname)
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    (!isAllowedAuthPath && (pathname === "/auth" || pathname.startsWith("/auth/")))
  ) {
    return "/"
  }

  return `${url.pathname}${url.search}${url.hash}`
}

/** Read and normalize the return path carried by an auth callback query. */
export function normalizeReturnPathFromSearch(
  search: string,
  origin: string,
  allowedAuthPaths: readonly string[] = [],
): string {
  return normalizeReturnPath(
    new URLSearchParams(search).get("redirectTo"),
    origin,
    allowedAuthPaths,
  )
}
