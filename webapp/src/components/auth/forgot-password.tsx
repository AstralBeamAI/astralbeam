// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Remove the unconfigured CAPTCHA surface; use browser-safe globals; preserve return paths when browser storage is unavailable, strict typing, and a semantic heading.

"use client"

import { getAuthLinkURL, getViewURL } from "@better-auth-ui/core"
import { useAuth, useFetchOptions, useRequestPasswordReset } from "@better-auth-ui/react"
import { type SyntheticEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { RESET_LINK_SENT_STORAGE_KEY } from "./reset-link-sent"

export type ForgotPasswordProps = {
  className?: string
}

/**
 * Render a card-based "Forgot Password" form that sends a password-reset email.
 *
 * The form displays an email input, submit button, and a link back to sign-in.
 * After a successful request the submitted email is stored in `sessionStorage`
 * and the user is redirected to the reset-link-sent view, which offers to open
 * their email provider.
 *
 * @param className - Optional additional CSS class names applied to the card
 * @returns The forgot-password form UI as a JSX element
 */
export function ForgotPassword({ className }: ForgotPasswordProps) {
  const {
    authClient,
    baseURL,
    basePaths,
    localization,
    navigate,
    redirectTo,
    viewPaths,
    Link,
  } = useAuth()

  const { fetchOptions, resetFetchOptions } = useFetchOptions()

  const { mutate: requestPasswordReset, isPending } = useRequestPasswordReset(
    authClient,
    {
      onError: () => {
        resetFetchOptions()
      },
      onSuccess: (_data, { email }) => {
        try {
          globalThis.sessionStorage.setItem(RESET_LINK_SENT_STORAGE_KEY, email)
        } catch {
          // The stored email is only a convenience for the confirmation view.
        }
        navigate({
          to: getAuthLinkURL(
            `${basePaths.auth}/${viewPaths.auth.resetLinkSent}`,
            redirectTo,
          ),
        })
      },
    },
  )

  function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    requestPasswordReset({
      email: formData.get("email") as string,
      redirectTo: getAuthLinkURL(
        getViewURL(
          baseURL,
          basePaths.auth,
          viewPaths.auth.resetPassword,
        ),
        redirectTo,
      ),
      fetchOptions,
    })
  }

  const [fieldErrors, setFieldErrors] = useState<{
    email: string | undefined
  }>({ email: undefined })

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          <h1>{localization.auth.forgotPassword}</h1>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={!!fieldErrors.email}>
              <FieldLabel htmlFor="email">{localization.auth.email}</FieldLabel>

              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder={localization.auth.emailPlaceholder}
                required
                disabled={isPending}
                onChange={() => {
                  setFieldErrors((prev) => ({
                    ...prev,
                    email: undefined,
                  }))
                }}
                onInvalid={(e) => {
                  e.preventDefault()
                  const el = e.target as HTMLInputElement
                  const msg = el.validity.valueMissing
                    ? localization.auth.fieldRequired
                    : localization.auth.invalidEmail

                  setFieldErrors((prev) => ({
                    ...prev,
                    email: msg,
                  }))
                }}
                aria-invalid={!!fieldErrors.email}
              />

              <FieldError>{fieldErrors.email}</FieldError>
            </Field>

            <div className="flex flex-col gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending && <Spinner />}

                {localization.auth.sendResetLink}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            {localization.auth.rememberYourPassword}{" "}
            <Link
              href={getAuthLinkURL(
                `${basePaths.auth}/${viewPaths.auth.signIn}`,
                redirectTo,
              )}
              className="underline underline-offset-4"
            >
              {localization.auth.signIn}
            </Link>
          </FieldDescription>
        </div>
      </CardContent>
    </Card>
  )
}
