import { useSession } from "@better-auth-ui/react"
import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"

import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"
import { APP_NAME } from "@/lib/constants"
import { AppShell } from "../-components/app-shell"
import { AppSidebar } from "../-components/app-sidebar"
import { getUserInvitations } from "../-functions/get-user-invitations"
import { OrganizationOnboarding } from "./-components/organization-onboarding"

export const Route = createFileRoute("/_authenticated/onboarding/")({
  beforeLoad: ({ context: { access } }) => {
    if (access.status === "ready") {
      throw redirect({ href: `/${access.organizationSlug}`, replace: true })
    }
  },
  loader: async ({ context: { access, queryClient } }) => {
    queryClient.setQueryData(
      organizationQueryKeys.userInvitations.list(access.userId),
      await getUserInvitations(),
    )
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
    <AppShell sidebar={<AppSidebar organization={null} />}>
      <OrganizationOnboarding
        email={session.data.user.email}
        onInvitationAction={() => router.invalidate()}
        onOrganizationCreated={(organization) => navigate({ href: `/${organization.slug}` })}
      />
    </AppShell>
  )
}
