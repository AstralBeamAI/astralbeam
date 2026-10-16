import { useSession } from "@better-auth-ui/react"
import { useMatches } from "@tanstack/react-router"
import posthog from "posthog-js"
import { useEffect } from "react"

import { authClient } from "@/lib/auth/client"

export function AnalyticsIdentity() {
  const { data: session, isPending, error } = useSession(authClient)
  const organization = useMatches({
    select: (matches) =>
      matches.find((match) => match.routeId === "/_authenticated/$orgSlug")?.context.organization,
  })

  useEffect(() => {
    if (window.location.origin !== "https://astralbeam.ai" || isPending || error) return
    const user = session?.user
    const identifiedUserId: unknown = posthog.get_property("$user_id")
    if (identifiedUserId && identifiedUserId !== user?.id) posthog.reset()
    if (!user) return

    posthog.identify(user.id, { name: user.name, email: user.email })
    if (organization) {
      posthog.register({
        organization_id: organization.organizationId,
        organization_name: organization.organizationName,
      })
      posthog.group("organization", organization.organizationId, {
        name: organization.organizationName,
      })
    }
  }, [session, isPending, error, organization])

  return null
}
