import { notFound, redirect } from "@tanstack/react-router"

import { parseServerFnError } from "@/lib/runtime/server-fn-error"

/**
 * Turns an organization access failure from a layout or page server function into navigation:
 * a missing organization and a non-member both render not-found. Anything else is rethrown.
 */
export function throwOrganizationRouteError(error: unknown, orgSlug: string): never {
  const { tag } = parseServerFnError(error)
  if (tag === "OrganizationNotFound") throw notFound()
  if (tag === "OrganizationAccessDenied") {
    throw redirect({ to: "/$orgSlug", params: { orgSlug }, replace: true })
  }
  if (tag === "SignInRequired") throw redirect({ href: "/auth/sign-in", replace: true })
  throw error
}
