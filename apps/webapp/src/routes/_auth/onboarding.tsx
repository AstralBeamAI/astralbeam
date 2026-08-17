import { $getActiveMember } from "@astralbeam/auth/tanstack/functions"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { OrganizationOnboarding } from "@/components/organization-onboarding"

export const Route = createFileRoute("/_auth/onboarding")({
  beforeLoad: async ({ abortController }) => {
    const member = await $getActiveMember({ signal: abortController.signal })
    if (member) throw redirect({ to: "/dashboard" })
  },
  component: OnboardingPage,
})

function OnboardingPage() {
  const { user } = Route.useRouteContext()

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <OrganizationOnboarding email={user.email} />
    </main>
  )
}
