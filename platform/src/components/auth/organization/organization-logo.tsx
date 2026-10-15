// Added with: bun run ui add @better-auth-ui/organization
// Local changes: Replace Lucide with Phosphor icons and derive stored logos from logoFileId.

"use client"

import type { Organization } from "better-auth/client"
import { BriefcaseIcon as Briefcase } from "@phosphor-icons/react"
import type { ComponentProps, CSSProperties, ReactNode } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "cn"
import { logoFileUrl } from "@/lib/organizations/images"

export type OrganizationLogoSize = "sm" | "md" | "lg"

export type OrganizationLogoProps = {
  className?: string
  fallback?: ReactNode
  isPending?: boolean
  organization?: (Partial<Organization> & { logoFileId?: string | null }) | null
  size?: OrganizationLogoSize
}

const sizeClasses: Record<OrganizationLogoSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
}

const fallbackTextClasses: Record<OrganizationLogoSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
}

export function OrganizationLogo({
  className,
  fallback,
  isPending,
  organization,
  size = "sm",
  style,
  ...props
}: OrganizationLogoProps &
  Omit<ComponentProps<typeof Avatar>, "children" | "size" | "style"> & {
    style?: CSSProperties
  }) {
  if (isPending && !organization) {
    return <Skeleton className={cn("rounded-full", sizeClasses[size], className)} style={style} />
  }

  const initials = organization?.name?.slice(0, 2).toUpperCase()
  const logo =
    organization?.id && organization.logoFileId
      ? logoFileUrl(organization.id, organization.logoFileId)
      : undefined

  return (
    <Avatar className={cn("rounded-full", sizeClasses[size], className)} style={style} {...props}>
      <AvatarImage alt={organization?.name ?? "Organization"} src={logo} />

      <AvatarFallback className={cn("text-muted-foreground!", fallbackTextClasses[size])}>
        {fallback || initials || <Briefcase className="size-4" />}
      </AvatarFallback>
    </Avatar>
  )
}
