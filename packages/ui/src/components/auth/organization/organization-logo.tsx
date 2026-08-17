// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/organization`
// Local edits: Uses Phosphor icons and allows explicitly undefined optional props under exact optional-property checks.

import { BriefcaseIcon } from "@phosphor-icons/react"
import type { Organization } from "better-auth/client"
import type { ComponentProps, CSSProperties, ReactNode } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar"
import { Skeleton } from "@/components/skeleton"
import { cn } from "@/lib/utils"

export type OrganizationLogoSize = "sm" | "md" | "lg"

export type OrganizationLogoProps = {
  className?: string | undefined
  fallback?: ReactNode | undefined
  isPending?: boolean | undefined
  organization?: Partial<Organization> | undefined
  size?: OrganizationLogoSize | undefined
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
    style?: CSSProperties | undefined
  }) {
  if (isPending && !organization) {
    return <Skeleton className={cn("rounded-full", sizeClasses[size], className)} style={style} />
  }

  const initials = organization?.name?.slice(0, 2).toUpperCase()
  const normalizedLogo = organization?.logo?.trim() || undefined

  return (
    <Avatar className={cn("rounded-full", sizeClasses[size], className)} style={style} {...props}>
      <AvatarImage alt={organization?.name ?? "Organization"} src={normalizedLogo} />

      <AvatarFallback className={cn("text-muted-foreground!", fallbackTextClasses[size])}>
        {fallback || initials || <BriefcaseIcon className="size-4" />}
      </AvatarFallback>
    </Avatar>
  )
}
