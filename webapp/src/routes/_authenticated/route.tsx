import { useAuthenticate } from "@better-auth-ui/react"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"
import { normalizeReturnPath } from "@/lib/auth/redirect"
import { getRouteSessionAccessDecision } from "@/lib/auth/session"
import { INERT_REDIRECT_ORIGIN } from "@/lib/constants"

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const access = await getRouteSessionAccessDecision(context.queryClient)
    if (access.status !== "signed-out") return { access }

    const redirectTo = normalizeReturnPath(
      location.href,
      INERT_REDIRECT_ORIGIN,
    )
    const search = new URLSearchParams({ redirectTo })
    throw redirect({ href: `/auth/sign-in?${search}`, replace: true })
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const session = useAuthenticate(authClient)

  if (session.isPending || !session.data) {
    return (
      <main className="grid min-h-svh place-items-center">
        <Spinner className="size-6" />
      </main>
    )
  }

  return <Outlet />
}
