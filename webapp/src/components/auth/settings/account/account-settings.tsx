// Added with: deno task ui add @better-auth-ui/settings
// Local changes: omit the disabled change-email flow; retain plugin account cards for appearance.

"use client"

import { useAuth } from "@better-auth-ui/react"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"
import { UserProfile } from "./user-profile"

export type AccountSettingsProps = {
  className?: string
}

/**
 * Renders the account settings layout.
 *
 * `UserProfile` always renders. Registered plugins may add account cards, such as the approved
 * appearance card from the theme plugin.
 */
export function AccountSettings({
  className,
  ...props
}: AccountSettingsProps & ComponentProps<"div">) {
  const { plugins } = useAuth()

  return (
    <div
      className={cn("flex w-full flex-col gap-4 md:gap-6", className)}
      {...props}
    >
      <UserProfile />
      {plugins.flatMap(
        (plugin) =>
          plugin.accountCards?.map((Card, index) => (
            <Card key={`${plugin.id}-${index.toString()}`} />
          )) ?? [],
      )}
    </div>
  )
}
