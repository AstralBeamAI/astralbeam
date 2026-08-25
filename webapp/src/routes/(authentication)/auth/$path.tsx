import { parseAuthResult, viewPaths } from "@better-auth-ui/core"
import { createFileRoute, notFound, redirect } from "@tanstack/react-router"

import { Auth } from "@/components/auth/auth"
import { getRouteSessionAccessDecision } from "@/lib/auth/session"
import { normalizeReturnPath, normalizeReturnPathFromSearch } from "@/lib/auth/redirect"
import { AUTH_RETURN_PATHS, INERT_REDIRECT_ORIGIN } from "@/lib/constants"

const AUTH_PATHS = new Set([
  ...Object.values(viewPaths.auth),
  "accept-invitation",
])
const AUTHENTICATED_AUTH_VIEWS = new Set([
  "accept-invitation",
  "callback",
  "error",
  "redirect",
  "reset-password",
  "sign-out",
])

export const Route = createFileRoute("/(authentication)/auth/$path")({
  beforeLoad: async ({ context, location, params }) => {
    if (!AUTH_PATHS.has(params.path)) throw notFound()

    const result = parseAuthResult(location.searchStr, "danger")
    if (result.reason === "signupDisabled" && params.path !== "sign-up") {
      const redirectTo = normalizeReturnPathFromSearch(
        location.searchStr,
        INERT_REDIRECT_ORIGIN,
        AUTH_RETURN_PATHS,
      )
      const search = new URLSearchParams({ redirectTo })
      throw redirect({
        href: `/auth/sign-up?${search}`,
        replace: true,
      })
    }

    const access = await getRouteSessionAccessDecision(context.queryClient)
    if (access.status === "signed-out") {
      if (params.path === "accept-invitation") {
        const invitationSearch = new URLSearchParams(location.searchStr).toString()
        const redirectTo = normalizeReturnPath(
          `${location.pathname}${invitationSearch ? `?${invitationSearch}` : ""}`,
          INERT_REDIRECT_ORIGIN,
          AUTH_RETURN_PATHS,
        )
        throw redirect({
          href: `/auth/sign-in?${new URLSearchParams({ redirectTo })}`,
          replace: true,
        })
      }
      return
    }

    const search = new URLSearchParams(location.searchStr)
    const isFreshSignIn = params.path === "sign-in" &&
      search.get("fresh") === "true"
    if (isFreshSignIn || AUTHENTICATED_AUTH_VIEWS.has(params.path)) return

    throw redirect({
      href: access.status === "onboarding" ? "/onboarding" : "/",
      replace: true,
    })
  },
  component: AuthRoute,
})

function AuthRoute() {
  const { path } = Route.useParams()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-10 sm:px-6">
      <Auth path={path} />
    </main>
  )
}
