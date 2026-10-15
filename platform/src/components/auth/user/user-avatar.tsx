// Added from @better-auth-ui/settings
// Local changes: remove username-plugin fields, use Phosphor icons, and use the displayed Organization’s member avatar, with initials outside Organizations.

import { useMatches } from "@tanstack/react-router"
import { avatarFileUrl } from "@/lib/organizations/images"
import { useAuth, useSession } from "@better-auth-ui/react"
import type { User } from "better-auth"
import { UserIcon as User2 } from "@phosphor-icons/react"
import { type ReactNode } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "cn"

export type UserAvatarProps = {
  avatarUrl?: string | undefined
  className?: string
  fallback?: ReactNode
  isPending?: boolean
  /** @remarks `User` */
  user?: Partial<User> | undefined
}

// Use the current Organization membership avatar, or an explicit membership URL for member rows.
export function UserAvatar({ avatarUrl, className, user, isPending, fallback }: UserAvatarProps) {
  const organization = useMatches({
    select: (matches) =>
      matches.find((match) => match.routeId === "/_authenticated/$orgSlug")?.context.organization,
  })
  const { authClient } = useAuth()
  const { data: session, isPending: sessionPending } = useSession(authClient, {
    enabled: !user && !isPending,
  })
  const resolvedUser = user ?? session?.user
  if ((isPending || sessionPending) && !user) {
    return <Skeleton className={cn("size-8 rounded-full", className)} />
  }

  const initials = (resolvedUser?.name || resolvedUser?.email)?.slice(0, 2).toUpperCase()

  return (
    <Avatar className={cn("size-8 bg-muted text-foreground text-sm rounded-full", className)}>
      <AvatarImage
        src={
          user
            ? avatarUrl
            : organization?.avatarFileId
              ? avatarFileUrl(organization.organizationId, organization.avatarFileId)
              : undefined
        }
        alt={resolvedUser?.name || resolvedUser?.email}
        referrerPolicy="no-referrer"
      />

      <AvatarFallback className="text-muted-foreground!">
        {fallback || initials || <User2 className="size-4" />}
      </AvatarFallback>
    </Avatar>
  )
}
