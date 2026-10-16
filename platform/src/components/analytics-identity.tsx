import { useSession } from "@better-auth-ui/react"
import { useMatches, useRouterState } from "@tanstack/react-router"
import posthog from "posthog-js"
import { useEffect, useRef } from "react"

import { authClient } from "@/lib/auth/client"

export function AnalyticsIdentity() {
  const { data: session, isPending, error } = useSession(authClient)
  const organization = useMatches({
    select: (matches) =>
      matches.find((match) => match.routeId === "/_authenticated/$orgSlug")?.context.organization,
  })

  const href = useRouterState({ select: (state) => state.resolvedLocation?.href })
  const lastPageview = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (window.location.origin !== "https://astralbeam.ai" || isPending || error) return
    const user = session?.user
    const identifiedUserId: unknown = posthog.get_property("$user_id")
    if (identifiedUserId && identifiedUserId !== user?.id) posthog.reset()
    if (user) posthog.identify(user.id, { name: user.name, email: user.email })
    if (user && organization) {
      posthog.register({
        organization_id: organization.organizationId,
        organization_name: organization.organizationName,
      })
      posthog.group("organization", organization.organizationId, {
        name: organization.organizationName,
      })
    }
    if (href && href !== lastPageview.current) {
      posthog.capture("$pageview", { $current_url: new URL(href, window.location.origin).href })
      lastPageview.current = href
    }
  }, [session, isPending, error, organization, href])

  return null
}
