import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"

import { normalizeAuthRedirect } from "@/auth/auth-redirect"
import { Auth } from "@/components/auth/auth"
import { getSession } from "@/server/session.functions"

const authPaths = new Set(["sign-in", "sign-out", "sign-up"])

type AuthSearch = {
  error?: string
  reauthenticate?: boolean
  redirectTo?: string
}

function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  const error = typeof search.error === "string" ? search.error : undefined
  const reauthenticate = search.reauthenticate === true || search.reauthenticate === "true"
  const redirectTo = normalizeAuthRedirect(search.redirectTo)
  return {
    ...(error === undefined ? {} : { error }),
    ...(reauthenticate ? { reauthenticate } : {}),
    ...(redirectTo === undefined ? {} : { redirectTo }),
  }
}

export const Route = createFileRoute("/(authentication)/auth/$path")({
  validateSearch: validateAuthSearch,
  beforeLoad: async ({ params, search }) => {
    if (!authPaths.has(params.path)) throw notFound()
    if (params.path === "sign-in" && search.error === "signup_disabled") {
      throw redirect({
        to: "/auth/$path",
        params: { path: "sign-up" },
        search: search.redirectTo ? { redirectTo: search.redirectTo } : {},
        replace: true,
      })
    }
    if (params.path !== "sign-out" && !search.reauthenticate && (await getSession())) {
      if (search.redirectTo) throw redirect({ href: search.redirectTo })
      throw redirect({ to: "/dashboard" })
    }
  },
  component: AuthPage,
})

function AuthPage() {
  const { path } = Route.useParams()
  const { error, redirectTo } = Route.useSearch()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-4">
        <Link aria-label="AstralBeam home" className="block w-fit" to="/">
          <img alt="AstralBeam" className="h-9 w-auto" src="/astralbeam-wordmark-light.svg" />
        </Link>
        {error
          ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Authentication could not be completed. Please try again.
            </p>
          )
          : null}
        <Auth
          className="max-w-none"
          path={path}
          {...(redirectTo === undefined ? {} : { redirectTo })}
        />
      </div>
    </main>
  )
}
