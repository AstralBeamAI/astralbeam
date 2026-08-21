import { createFileRoute, redirect } from "@tanstack/react-router"

import { OrganizationsSettings } from "@/components/auth/organization/organizations-settings"
import { getActiveOrganizationMembership } from "@/server/session.functions"

export const Route = createFileRoute("/_authenticated/onboarding")({
  beforeLoad: async () => {
    const membership = await getActiveOrganizationMembership()
    if (membership?.member) throw redirect({ to: "/dashboard" })
  },
  component: OnboardingPage,
})

function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 py-16">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Welcome to AstralBeam</p>
        <h1 className="text-3xl font-semibold tracking-tight">Choose your organization</h1>
        <p className="text-muted-foreground">
          Create a workspace or select access that has already been provisioned for you.
        </p>
      </div>
      <OrganizationsSettings />
    </main>
  )
}
