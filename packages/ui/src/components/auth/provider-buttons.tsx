// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/provider-buttons`
// Local edits: Computes the small provider layout directly instead of retaining upstream manual memoization and forwards validated redirect, sign-up, and onboarding state to each provider.

"use client"

import { useAuth } from "@better-auth-ui/react"

import { cn } from "@/lib/utils"
import { ProviderButton } from "./provider-button"

export type ProviderButtonsProps = {
  socialLayout?: SocialLayout
  view?: "signIn" | "signUp"
  termsVersion?: string | undefined
  newUserRedirectTo?: string | undefined
  redirectTo?: string | undefined
}

export type SocialLayout = "auto" | "horizontal" | "vertical" | "grid"

/**
 * Render sign-in buttons for configured social providers. Each button owns its own sign-in mutation
 * and reads the shared sign-in pending state from React Query.
 *
 * @param socialLayout - Preferred layout for the provider buttons; `"auto"` chooses based on the number of providers.
 */
export function ProviderButtons({
  newUserRedirectTo,
  redirectTo,
  socialLayout = "auto",
  termsVersion,
  view = "signIn",
}: ProviderButtonsProps) {
  const { socialProviders } = useAuth()

  let resolvedSocialLayout = socialLayout
  if (resolvedSocialLayout === "auto") {
    if (socialProviders?.length && socialProviders.length >= 4) {
      resolvedSocialLayout = "horizontal"
    } else {
      resolvedSocialLayout = "vertical"
    }
  }

  return (
    <div
      className={cn(
        "gap-3",
        resolvedSocialLayout === "grid" && "grid grid-cols-2",
        resolvedSocialLayout === "vertical" && "flex flex-col",
        resolvedSocialLayout === "horizontal" && "flex flex-row flex-wrap",
      )}
    >
      {socialProviders?.map((provider) => (
        <ProviderButton
          key={provider}
          provider={provider}
          newUserRedirectTo={newUserRedirectTo}
          redirectTo={redirectTo}
          termsVersion={termsVersion}
          view={view}
          display={
            resolvedSocialLayout === "vertical"
              ? "full"
              : resolvedSocialLayout === "grid"
                ? "name"
                : "icon"
          }
          className={cn(resolvedSocialLayout === "horizontal" && "flex-1")}
        />
      ))}
    </div>
  )
}
