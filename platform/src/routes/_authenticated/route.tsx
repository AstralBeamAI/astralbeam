import { useAuthenticate } from "@better-auth-ui/react"
import { createFileRoute, notFound, Outlet, redirect, useMatches } from "@tanstack/react-router"
import { useState } from "react"

import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"
import { normalizeReturnPath } from "@/lib/auth/redirect"
import { getRouteSessionAccessDecision } from "@/lib/auth/session"
import { INERT_REDIRECT_ORIGIN } from "@/lib/constants"
import { isValidSlug } from "@/lib/organizations/slug"
import { AppShell } from "./-components/app-shell"
import { DogfoodChat } from "./-components/dogfood-chat"
import { DirectoryCacheContext } from "./-lib/directory-cache"

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location, matches }) => {
    if (
      matches.some(
        (match) =>
          match.routeId === "/_authenticated/$orgSlug" && !isValidSlug(match.params.orgSlug),
      )
    ) {
      throw notFound({ routeId: "__root__" })
    }
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
  const { access } = Route.useRouteContext()
  const organization = useMatches({
    select: (matches) =>
      matches.find((match) => match.routeId === "/_authenticated/$orgSlug")?.context.organization ??
      null,
  })
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
      {organization ? (
        <DogfoodChat
          key={`${access.userId}:${organization.organizationId}`}
          organization={organization}
        >
          <AppShell organization={organization}>
            <Outlet />
          </AppShell>
        </DogfoodChat>
      ) : (
        <Outlet />
      )}
    </DirectoryCacheContext>
  )
}
