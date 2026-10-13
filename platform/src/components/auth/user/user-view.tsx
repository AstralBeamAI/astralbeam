// Added with: deno task ui add @better-auth-ui/user-button
// Local changes: remove username fields, accept membership avatar URLs, and optionally wrap the name and email.

import { useAuth, useSession } from "@better-auth-ui/react"
import type { User } from "better-auth"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "cn"
import { UserAvatar } from "./user-avatar"

export type UserViewProps = {
  avatarUrl?: string | undefined
  className?: string
  isPending?: boolean
  /**
   * When true, the subtitle line (email when a name is shown) is hidden.
   * @default false
   */
  hideSubtitle?: boolean
  /** @remarks `User` */
  user?: Partial<User> | undefined
  /** Wraps a long name or email onto more lines instead of truncating it. */
  wrap?: boolean
}

export function UserView({
  avatarUrl,
  className,
  isPending,
  hideSubtitle = false,
  user,
  wrap = false,
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
      <UserAvatar user={user} avatarUrl={avatarUrl} />

      <div className="grid min-w-0 flex-1 text-start text-sm leading-tight">
        <span className={cn("font-medium text-foreground", wrap ? "wrap-anywhere" : "truncate")}>
          {resolvedUser?.name || resolvedUser?.email}
        </span>

        {!hideSubtitle && resolvedUser?.name && (
          <span
            className={cn("text-muted-foreground text-xs", wrap ? "wrap-anywhere" : "truncate")}
          >
            {resolvedUser?.email}
          </span>
        )}
      </div>
    </div>
  )
}
