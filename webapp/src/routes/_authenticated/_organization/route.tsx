import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { getActiveOrganizationMembership } from "@/server/session.functions"

export const Route = createFileRoute("/_authenticated/_organization")({
  beforeLoad: async () => {
    const membership = await getActiveOrganizationMembership()
    if (!membership?.member) throw redirect({ to: "/onboarding" })
    return { membership }
  },
  component: Outlet,
})
