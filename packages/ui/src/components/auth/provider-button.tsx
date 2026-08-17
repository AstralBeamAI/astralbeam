// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/provider-button`
// Local edits: Accepts the route-validated redirect target, preserves it on OAuth errors, and explicitly separates social sign-in from terms-gated sign-up and new-user onboarding.

import { authMutationKeys, getAuthLinkURL, getProviderName } from "@better-auth-ui/core"
import { providerIcons, useAuth, useSignInSocial } from "@better-auth-ui/react"
import { useIsMutating } from "@tanstack/react-query"
import type { SocialProvider } from "better-auth/social-providers"
import type { ComponentProps } from "react"

import { Button } from "@/components/button"
import { Spinner } from "@/components/spinner"
import { cn } from "@/lib/utils"
import { LastUsedBadge } from "./last-login-method/last-used-badge"

export type ProviderButtonProps = {
  provider: SocialProvider
  display?: "full" | "name" | "icon"
  view?: "signIn" | "signUp"
  termsVersion?: string | undefined
  newUserRedirectTo?: string | undefined
  redirectTo?: string | undefined
} & Omit<ComponentProps<typeof Button>, "onClick" | "children" | "disabled">

/**
 * Social provider sign-in button.
 *
 * @param provider - Provider to sign in with.
 * @param display - `"full"` (e.g. "Continue with Google"), `"name"` (just the provider name), or `"icon"` (icon only).
 */
export function ProviderButton({
  provider,
  newUserRedirectTo,
  redirectTo: redirectToProp,
  termsVersion,
  display = "full",
  view = "signIn",
  variant = "outline",
  className,
  ...props
}: ProviderButtonProps) {
  const {
    authClient,
    basePaths,
    baseURL,
    localization,
    redirectTo: configuredRedirectTo,
    viewPaths,
  } = useAuth()
  const redirectTo = redirectToProp ?? configuredRedirectTo

  const callbackURL = `${baseURL}${redirectTo}`
  const errorCallbackURL = getAuthLinkURL(
    `${baseURL}${basePaths.auth}/${viewPaths.auth[view]}`,
    redirectTo,
  )
  const newUserCallbackURL = newUserRedirectTo ? `${baseURL}${newUserRedirectTo}` : undefined

  const { mutate: signInSocial, isPending: signInSocialPending } = useSignInSocial(authClient)

  const ProviderIcon = providerIcons[provider]

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  })
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  })
  const isPending = signInMutating + signUpMutating > 0
  function handleSignIn() {
    signInSocial({
      provider,
      callbackURL,
      errorCallbackURL,
      newUserCallbackURL,
      requestSignUp: view === "signUp",
      additionalData:
        view === "signUp" && termsVersion ? { termsAccepted: true, termsVersion } : undefined,
    })
  }

  return (
    <Button
      type="button"
      variant={variant}
      disabled={isPending}
      onClick={handleSignIn}
      className={cn("relative overflow-visible", className)}
      {...props}
    >
      {signInSocialPending ? <Spinner /> : ProviderIcon ? <ProviderIcon /> : null}

      {display === "full"
        ? localization.auth.continueWith.replace("{{provider}}", getProviderName(provider))
        : display === "name"
          ? getProviderName(provider)
          : null}

      {display === "icon" && <span className="sr-only">{getProviderName(provider)}</span>}

      {view !== "signUp" && <LastUsedBadge method={provider} floating />}
    </Button>
  )
}
