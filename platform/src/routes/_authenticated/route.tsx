import { useAuthenticate } from "@better-auth-ui/react"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useState } from "react"

import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"
import { normalizeReturnPath } from "@/lib/auth/redirect"
import { getRouteSessionAccessDecision } from "@/lib/auth/session"
import { INERT_REDIRECT_ORIGIN } from "@/lib/constants"
import { DogfoodChat } from "./-components/dogfood-chat"
import { DirectoryCacheContext } from "./-lib/directory-cache"

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const access = await getRouteSessionAccessDecision(context.queryClient)
    if (access.status !== "signed-out") return { access }

    const redirectTo = normalizeReturnPath(location.href, INERT_REDIRECT_ORIGIN)
    const search = new URLSearchParams({ redirectTo })
    throw redirect({ href: `/auth/sign-in?${search}`, replace: true })
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const session = useAuthenticate(authClient)
  const [directoryCacheKey] = useState(() => ({}))

  if (session.isPending || !session.data) {
    return (
      <main className="grid min-h-svh place-items-center">
        <Spinner className="size-6" />
      </main>
    )
  }

  return (
    <DirectoryCacheContext value={directoryCacheKey}>
      <div className="group/dogfood flex items-start">
        <DogfoodChat>
          <div className="min-w-0 flex-1 group-has-[[data-dogfood-chat=open]_[data-astralbeam-full-width=true]]/dogfood:hidden max-lg:group-has-[[data-dogfood-chat=open]]/dogfood:hidden">
            <Outlet />
          </div>
        </DogfoodChat>
      </div>
    </DirectoryCacheContext>
  )
}
