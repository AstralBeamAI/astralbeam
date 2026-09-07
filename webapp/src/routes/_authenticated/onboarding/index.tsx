import { useSession } from "@better-auth-ui/react"
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"

import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"
import { APP_NAME } from "@/lib/constants"
import { OrganizationOnboarding } from "./-components/organization-onboarding"

export const Route = createFileRoute("/_authenticated/onboarding/")({
  beforeLoad: ({ context: { access } }) => {
    if (access.status === "ready") {
      throw redirect({ href: `/${access.organizationSlug}`, replace: true })
    }
  },
  component: OnboardingRoute,
  head: () => ({ meta: [{ title: `Get started · ${APP_NAME}` }] }),
})

function OnboardingRoute() {
  const navigate = useNavigate()
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
        onInvitationAction={() => router.invalidate()}
        onOrganizationCreated={(organization) => navigate({ href: `/${organization.slug}` })}
      />
    </main>
  )
}
