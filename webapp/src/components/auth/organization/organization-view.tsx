// Added with: deno task ui add @better-auth-ui/organization
// Local changes: repair strict optional props and query only the signed-in member for static role labels.

import {
  memberRoleLabels,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import {
  useActiveOrganization,
  useListOrganizationMembers,
} from "@better-auth-ui/react/plugins/organization"
import type { Organization } from "better-auth/client"
import type { ComponentProps } from "react"

import { Badge } from "@/components/ui/badge"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { cn } from "cn"
import { OrganizationLogo, type OrganizationLogoSize } from "./organization-logo"
import { OrganizationViewSkeleton } from "./organization-view-skeleton"

export type OrganizationViewProps = {
  className?: string
  isPending?: boolean
  size?: OrganizationLogoSize
  hideRole?: boolean
  hideSlug?: boolean
  organization?: Partial<Organization>
}

/**
 * Compact organization row: logo, primary name, secondary slug — analogous to `UserView`.
 */
export function OrganizationView({
  className,
  isPending,
  size = "md",
  hideSlug,
  hideRole,
  organization,
  ...props
}: OrganizationViewProps & ComponentProps<"div">) {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const { roles, slugPrefix } = useAuthPlugin(organizationPlugin)

  const { data: session } = useSession(authClient)

  const { data: activeOrganization, isPending: activeOrganizationPending } = useActiveOrganization(
    authClient,
    {
      enabled: !organization && !isPending,
    },
  )

  const resolvedOrganization = organization ?? activeOrganization

  const { data: membersList, isPending: membersPending } = useListOrganizationMembers(authClient, {
    query: {
      organizationId: resolvedOrganization?.id,
      filterField: "userId",
      filterValue: session?.user.id ?? "",
      limit: 1,
    },
    enabled: !!resolvedOrganization?.id && !!session?.user.id && !hideRole,
  })

  const membership = membersList?.members[0]
  const roleLabel = membership ? memberRoleLabels(membership.role, roles).join(", ") : undefined

  if (
    isPending ||
    (!organization && activeOrganizationPending) ||
    (!hideRole && !!resolvedOrganization?.id && membersPending)
  ) {
    return (
      <OrganizationViewSkeleton
        size={size}
        {...(className ? { className } : {})}
        {...(hideSlug === undefined ? {} : { hideSlug })}
        {...props}
      />
    )
  }

  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <OrganizationLogo
        className={size === "sm" ? "size-5" : ""}
        size={size === "lg" ? "md" : "sm"}
        {...(resolvedOrganization ? { organization: resolvedOrganization } : {})}
      />

      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium leading-tight text-foreground">
            {resolvedOrganization?.name}
          </p>

          {!hideRole && !!membership && (
            <Badge variant="secondary" className="-my-0.5 shrink-0">
              {roleLabel}
            </Badge>
          )}
        </div>

        {!hideSlug && !!resolvedOrganization?.slug && (
          <p className="truncate overflow-x-hidden text-muted-foreground text-xs font-mono leading-tight">
            {slugPrefix}
            {resolvedOrganization.slug}
          </p>
        )}
      </div>
    </div>
  )
}
