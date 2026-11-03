import { useAuth, useSession } from "@better-auth-ui/react"
import {
  organizationQueryKeys,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useListUserInvitations } from "@better-auth-ui/react/plugins/organization"
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router"

import { Spinner } from "@/components/ui/spinner"
import { APP_NAME } from "@/lib/constants"
import { getUserInvitations } from "../../-functions/get-user-invitations"
import { OrganizationOnboarding } from "./-components/organization-onboarding"

export const Route = createFileRoute("/_authenticated/_user/onboarding/")({
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
  const { authClient } = useAuth<OrganizationAuthClient>()
  const navigate = useNavigate()
  const router = useRouter()
  const session = useSession(authClient)
  const { data: invitations } = useListUserInvitations(authClient, {
    enabled: session.data?.user.emailVerified === true,
  })

  if (session.isPending || !session.data) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  return (
    <OrganizationOnboarding
      email={session.data.user.email}
      hasInvitations={Boolean(invitations?.length)}
      onInvitationAction={() => router.invalidate()}
      onOrganizationCreated={(organization) => navigate({ href: `/${organization.slug}` })}
    />
  )
}
