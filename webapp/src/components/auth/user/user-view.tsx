// Added with: deno task ui add @better-auth-ui/user-button
// Local changes: remove username-plugin fields and apply strict optional typing.

import { useAuth, useSession } from "@better-auth-ui/react"
import type { User } from "better-auth"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "cn"
import { UserAvatar } from "./user-avatar"

export type UserViewProps = {
  className?: string
  isPending?: boolean
  /**
   * When true, the subtitle line (email when a name is shown) is hidden.
   * @default false
   */
  hideSubtitle?: boolean
  /** @remarks `User` */
  user?: Partial<User> | undefined
}

/**
 * Render a compact user item with an avatar, a primary label (name or email), and an optional subtitle (email).
 *
 * @param isPending - If true and no `user` prop is provided, renders a loading skeleton instead of user details
 * @param className - Additional CSS classes applied to the outer container
 * @param hideSubtitle - When true, omits the muted subtitle row under the primary label
 * @param user - Optional user object to display; when omitted the current session user is used
 * @returns A React element showing the user's avatar with their identifying information
 */
export function UserView({
  className,
  isPending,
  hideSubtitle = false,
  user,
}: UserViewProps) {
  const { authClient } = useAuth()
  const { data: session, isPending: sessionPending } = useSession(authClient, {
    enabled: !user && !isPending,
  })

  const resolvedUser = user ?? session?.user

  if ((isPending || sessionPending) && !user) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", className)}>
        <UserAvatar isPending />

        <div className="grid flex-1 gap-1 text-start text-sm">
          <Skeleton className="h-4 w-24" />

          {!hideSubtitle && <Skeleton className="h-3 w-32" />}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <UserAvatar {...(resolvedUser ? { user: resolvedUser } : {})} />

      <div className="grid min-w-0 flex-1 text-start text-sm leading-tight">
        <span className="truncate font-medium text-foreground">
          {resolvedUser?.name || resolvedUser?.email}
        </span>

        {!hideSubtitle &&
          resolvedUser?.name && (
          <span className="text-muted-foreground truncate text-xs">
            {resolvedUser?.email}
          </span>
        )}
      </div>
    </div>
  )
}
