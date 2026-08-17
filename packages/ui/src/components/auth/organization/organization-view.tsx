// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/organization`
// Local edits: Keeps the upstream organization summary presentational because the SaaS switcher does not display organization roles.

import { useAuthPlugin } from "@better-auth-ui/react"
import type { Organization } from "better-auth/client"
import type { ComponentProps } from "react"

import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { cn } from "@/lib/utils"
import { OrganizationLogo, type OrganizationLogoSize } from "./organization-logo"
import { OrganizationViewSkeleton } from "./organization-view-skeleton"

export type OrganizationViewProps = {
  className?: string | undefined
  hideSlug?: boolean | undefined
  isPending?: boolean | undefined
  organization?: Partial<Organization> | null | undefined
  size?: OrganizationLogoSize | undefined
}

/** Displays a compact organization logo, name, and optional slug. */
export function OrganizationView({
  className,
  hideSlug,
  isPending,
  organization,
  size = "md",
  ...props
}: OrganizationViewProps & ComponentProps<"div">) {
  const { slugPrefix } = useAuthPlugin(organizationPlugin)

  if (isPending) {
    return (
      <OrganizationViewSkeleton className={className} hideSlug={hideSlug} size={size} {...props} />
    )
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
      <OrganizationLogo
        className={size === "sm" ? "size-5" : undefined}
        organization={organization ?? undefined}
        size={size === "lg" ? "md" : "sm"}
      />

      <div className="flex min-w-0 flex-col">
        <p className="truncate text-sm font-medium leading-tight text-foreground">
          {organization?.name}
        </p>
        {!hideSlug && organization?.slug && (
          <p className="truncate overflow-x-hidden font-mono text-xs leading-tight text-muted-foreground">
            {slugPrefix}
            {organization.slug}
          </p>
        )}
      </div>
    </div>
  )
}
