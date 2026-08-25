import { useSession } from "@better-auth-ui/react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"

import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"
import { OrganizationOnboarding } from "./-components/organization-onboarding"

export const Route = createFileRoute("/_authenticated/onboarding/")({
  beforeLoad: ({ context: { access } }) => {
    if (access.status === "ready") {
      throw redirect({ href: "/", replace: true })
    }
  },
  component: OnboardingRoute,
})

function OnboardingRoute() {
  const router = useRouter()
  const session = useSession(authClient)

  if (session.isPending || !session.data) {
    return (
      <main className="grid min-h-svh place-items-center">
        <Spinner className="size-6" />
      </main>
    )
  }

  return (
    <main className="min-h-svh bg-background">
      <OrganizationOnboarding
        email={session.data.user.email}
        onOrganizationAccessChange={() => router.invalidate()}
      />
    </main>
  )
}
