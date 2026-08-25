// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Use redirect-mode OAuth, forward explicit signup/legal intent and error redirects, honor disabled state, and omit the unconfigured last-login badge.

"use client"

import {
  authMutationKeys,
  type AuthSocialProvider,
  type AuthView,
  getAuthLinkURL,
  getProviderId,
  getProviderName,
  getSafeRedirectTo,
} from "@better-auth-ui/core"
import { renderProviderIcon, useAuth, useSignInSocial } from "@better-auth-ui/react"
import { useIsMutating } from "@tanstack/react-query"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type ProviderButtonProps = {
  provider: AuthSocialProvider
  display?: "full" | "name" | "icon"
  termsAccepted?: boolean
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
  display = "full",
  disabled,
  termsAccepted = false,
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
    redirectTo,
    viewPaths,
  } = useAuth()

  const { mutate: signInSocial, isPending: signInSocialPending } = useSignInSocial(authClient)

  const providerId = getProviderId(provider)
  const providerIcon = renderProviderIcon(provider)

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  })
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  })
  const isPending = signInMutating + signUpMutating > 0
  const isDisabled = Boolean(disabled || isPending)

  const handleSignIn = () => {
    if (isDisabled || (view === "signUp" && !termsAccepted)) return

    const safeRedirectTo = getSafeRedirectTo(
      redirectTo,
      globalThis.location.origin,
    )

    const signUpOptions = view === "signUp"
      ? {
        additionalData: { termsAccepted: true },
        requestSignUp: true,
      }
      : {}

    signInSocial({
      provider: providerId,
      callbackURL: `${baseURL}${safeRedirectTo}`,
      errorCallbackURL: getAuthLinkURL(
        `${baseURL}${basePaths.auth}/${viewPaths.auth.error}`,
        safeRedirectTo,
      ),
      ...signUpOptions,
    })
  }

  return (
    <Button
      type="button"
      variant={variant}
      disabled={isDisabled}
      aria-busy={signInSocialPending}
      onClick={handleSignIn}
      className={cn("relative overflow-visible", className)}
      {...props}
    >
      {signInSocialPending ? <Spinner /> : providerIcon}

      {display === "full"
        ? localization.auth.continueWith.replace(
          "{{provider}}",
          getProviderName(provider),
        )
        : display === "name"
        ? getProviderName(provider)
        : null}

      {display === "icon" && <span className="sr-only">{getProviderName(provider)}</span>}
    </Button>
  )
}
