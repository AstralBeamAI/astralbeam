import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import type { ComponentPropsWithoutRef, PropsWithChildren } from "react"

import { authClient } from "@/auth/client"
import {
  ORGANIZATION_CREATION_ENABLED,
  ORGANIZATION_LIMIT,
  ORGANIZATION_MEMBERSHIP_LIMIT,
} from "@/auth/organization-policy"
import { AuthProvider } from "@/components/auth/auth-provider"
import { Toaster } from "@/components/ui/sonner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import "@/lib/auth/auth-plugin"

type AuthLinkProps = PropsWithChildren<
  & { className?: string; href: string; to?: string }
  & Pick<
    ComponentPropsWithoutRef<"a">,
    "aria-disabled" | "onClick" | "tabIndex"
  >
>

function AuthLink({ href, ...props }: AuthLinkProps) {
  return <Link to={href} {...props} />
}

const socialProviders = ["google", "github"] as const
const authPlugins = [
  organizationPlugin({
    allowOrganizationCreation: ORGANIZATION_CREATION_ENABLED,
    membershipLimit: ORGANIZATION_MEMBERSHIP_LIMIT,
    organizationLimit: ORGANIZATION_LIMIT,
    localization: {
      inviteMember: "Add access",
      inviteMemberDescription:
        "Existing users join immediately. New users receive access when they sign up.",
      inviteMemberSuccess: "Organization access updated",
      invitations: "Pending access",
    },
  }),
]

export function Providers({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const router = useRouter()

  return (
    <AuthProvider
      authClient={authClient}
      emailAndPassword={{ enabled: false }}
      Link={AuthLink}
      navigate={navigate}
      plugins={authPlugins}
      queryClient={router.options.context.queryClient}
      redirectTo="/dashboard"
      socialProviders={[...socialProviders]}
    >
      {children}
      <Toaster />
    </AuthProvider>
  )
}
