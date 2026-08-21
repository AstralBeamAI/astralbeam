import {
  authMutationKeys,
  type AuthSocialProvider,
  type AuthView,
  getAuthLinkURL,
  getProviderId,
  getProviderName,
  getViewURL,
  type OAuthPopupAuthClient,
} from "@better-auth-ui/core"
import {
  renderProviderIcon,
  useAuth,
  useSignInOAuthPopup,
  useSignInSocial,
} from "@better-auth-ui/react"
import { useIsMutating } from "@tanstack/react-query"
import type { ComponentProps } from "react"

import { CURRENT_TERMS_VERSION } from "@/auth/terms"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { LastUsedBadge } from "./last-login-method/last-used-badge"

export type ProviderButtonProps = {
  provider: AuthSocialProvider
  display?: "full" | "name" | "icon"
  redirectTo?: string
  view?: AuthView
} & Omit<ComponentProps<typeof Button>, "onClick" | "children">

/**
 * Social provider sign-in button.
 *
 * @param provider - Provider to sign in with.
 * @param display - `"full"` (e.g. "Continue with Google"), `"name"` (just the provider name), or `"icon"` (icon only).
 */
export function ProviderButton({
  provider,
  redirectTo: requestedRedirectTo,
  display = "full",
  view = "signIn",
  variant = "outline",
  className,
  disabled,
  ...props
}: ProviderButtonProps) {
  const {
    authClient,
    basePaths,
    baseURL,
    localization,
    navigate,
    redirectTo: defaultRedirectTo,
    socialSignInMode,
    viewPaths,
  } = useAuth()

  const redirectTo = requestedRedirectTo ?? defaultRedirectTo
  const callbackURL = `${baseURL}${redirectTo}`
  const errorCallbackURL = getAuthLinkURL(
    getViewURL(
      baseURL,
      basePaths.auth,
      view === "signUp" ? viewPaths.auth.signUp : viewPaths.auth.signIn,
    ),
    redirectTo,
  )
  const signUpData = view === "signUp"
    ? {
      requestSignUp: true,
      additionalData: {
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      },
    }
    : {}

  const { mutate: signInSocial, isPending: signInSocialPending } = useSignInSocial(authClient)
  const { mutate: signInPopup, isPending: signInPopupPending } = useSignInOAuthPopup(
    authClient as OAuthPopupAuthClient,
  )

  const providerId = getProviderId(provider)
  const providerIcon = renderProviderIcon(provider)

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  })
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  })
  const isPending = signInMutating + signUpMutating > 0

  const handleSignIn = () => {
    if (socialSignInMode === "popup") {
      signInPopup(
        {
          provider: providerId,
          callbackURL,
          errorCallbackURL,
          ...signUpData,
        },
        { onSuccess: () => navigate({ to: redirectTo }) },
      )
      return
    }

    signInSocial({ provider: providerId, callbackURL, errorCallbackURL, ...signUpData })
  }

  return (
    <Button
      type="button"
      variant={variant}
      disabled={isPending || disabled}
      onClick={handleSignIn}
      className={cn("relative overflow-visible", className)}
      {...props}
    >
      {signInSocialPending || signInPopupPending ? <Spinner /> : providerIcon}

      {display === "full"
        ? localization.auth.continueWith.replace(
          "{{provider}}",
          getProviderName(provider),
        )
        : display === "name"
        ? getProviderName(provider)
        : null}

      {display === "icon" && <span className="sr-only">{getProviderName(provider)}</span>}

      {view !== "signUp" && <LastUsedBadge method={providerId} floating />}
    </Button>
  )
}
