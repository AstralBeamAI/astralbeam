// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Use Phosphor icons, the contextual Base UI Toast manager, Deno-compatible browser globals, and domain-specific function names; preserve strict error-state typing; render a semantic page heading. Share password visibility controls.

"use client"

import { getAuthLinkURL, isPasswordCompromisedError } from "@better-auth-ui/core"
import { useAuth, useResetPassword } from "@better-auth-ui/react"
import { type SyntheticEvent, useEffect, useState } from "react"
import { useToastManager } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { PasswordInput } from "@/components/auth/password-input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "cn"
import { PasswordStrengthMeter } from "./password-strength-meter"

export type ResetPasswordProps = {
  className?: string
}

/**
 * Render a password reset form that validates the reset token from the URL, accepts a new password (and optional confirmation), and submits it to the auth client.
 *
 * The component checks for a `token` query parameter on mount and, if missing, shows an error toast and navigates to the sign-in page. It exposes per-field validation messages, toggles for password visibility, and disables inputs while the reset request is pending.
 *
 * @returns The password reset form UI ready to be mounted in the app layout.
 */
export function ResetPassword({ className }: ResetPasswordProps) {
  const { add: addToast } = useToastManager()
  const {
    authClient,
    basePaths,
    emailAndPassword,
    localization,
    navigate,
    redirectTo,
    viewPaths,
    Link,
  } = useAuth()
  const signInURL = getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, redirectTo)

  const { mutate: resetPassword, isPending } = useResetPassword(authClient, {
    onError: (error) => {
      // The haveIBeenPwned plugin rejects on the password itself, so it
      // belongs against the field rather than in a toast.
      if (isPasswordCompromisedError(error)) {
        setFieldErrors((prev) => ({
          ...prev,
          password: localization.auth.passwordCompromised,
        }))
      }
    },
    onSuccess: () => {
      addToast({ title: localization.auth.passwordResetSuccess, type: "success" })
      navigate({ to: signInURL })
    },
  })

  const [password, setPassword] = useState("")

  const [fieldErrors, setFieldErrors] = useState<{
    password: string | undefined
    confirmPassword: string | undefined
  }>({ password: undefined, confirmPassword: undefined })

  useEffect(() => {
    const searchParams = new URLSearchParams(globalThis.location.search)
    const token = searchParams.get("token") as string

    if (!token) {
      addToast({ title: localization.auth.invalidResetPasswordToken, type: "error" })
      navigate({ to: signInURL })
    }
  }, [addToast, localization.auth.invalidResetPasswordToken, navigate, signInURL])

  function submitPasswordReset(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()

    const searchParams = new URLSearchParams(globalThis.location.search)
    const token = searchParams.get("token") as string

    if (!token) {
      addToast({ title: localization.auth.invalidResetPasswordToken, type: "error" })
      navigate({ to: signInURL })
      return
    }

    const formData = new FormData(e.currentTarget)
    const password = formData.get("password") as string
    const confirmPassword = formData.get("confirmPassword") as string

    if (emailAndPassword?.confirmPassword && password !== confirmPassword) {
      addToast({ title: localization.auth.passwordsDoNotMatch, type: "error" })
      return
    }

    resetPassword({ token, newPassword: password })
  }

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          <h1>{localization.auth.resetPassword}</h1>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={submitPasswordReset}>
          <FieldGroup>
            <Field data-invalid={!!fieldErrors.password}>
              <FieldLabel htmlFor="password">{localization.auth.password}</FieldLabel>

              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder={localization.auth.newPasswordPlaceholder}
                required
                minLength={emailAndPassword?.minPasswordLength}
                maxLength={emailAndPassword?.maxPasswordLength}
                disabled={isPending}
                onChange={(e) => {
                  setPassword(e.target.value)

                  setFieldErrors((prev) => ({
                    ...prev,
                    password: undefined,
                  }))
                }}
                onInvalid={(e) => {
                  e.preventDefault()
                  const el = e.target as HTMLInputElement
                  const min = emailAndPassword?.minPasswordLength
                  const max = emailAndPassword?.maxPasswordLength
                  const msg = el.validity.valueMissing
                    ? localization.auth.fieldRequired
                    : el.validity.tooShort
                      ? localization.auth.tooShort.replace("{{min}}", String(min))
                      : localization.auth.tooLong.replace("{{max}}", String(max))

                  setFieldErrors((prev) => ({
                    ...prev,
                    password: msg,
                  }))
                }}
                aria-invalid={!!fieldErrors.password}
              />

              <FieldError>{fieldErrors.password}</FieldError>

              <PasswordStrengthMeter password={password} />
            </Field>

            {emailAndPassword?.confirmPassword && (
              <Field data-invalid={!!fieldErrors.confirmPassword}>
                <FieldLabel htmlFor="confirmPassword">
                  {localization.auth.confirmPassword}
                </FieldLabel>

                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder={localization.auth.confirmPasswordPlaceholder}
                  required
                  minLength={emailAndPassword?.minPasswordLength}
                  maxLength={emailAndPassword?.maxPasswordLength}
                  disabled={isPending}
                  onChange={() => {
                    setFieldErrors((prev) => ({
                      ...prev,
                      confirmPassword: undefined,
                    }))
                  }}
                  onInvalid={(e) => {
                    e.preventDefault()
                    const el = e.target as HTMLInputElement
                    const min = emailAndPassword?.minPasswordLength
                    const max = emailAndPassword?.maxPasswordLength
                    const msg = el.validity.valueMissing
                      ? localization.auth.fieldRequired
                      : el.validity.tooShort
                        ? localization.auth.tooShort.replace("{{min}}", String(min))
                        : localization.auth.tooLong.replace("{{max}}", String(max))

                    setFieldErrors((prev) => ({
                      ...prev,
                      confirmPassword: msg,
                    }))
                  }}
                  aria-invalid={!!fieldErrors.confirmPassword}
                />

                <FieldError>{fieldErrors.confirmPassword}</FieldError>
              </Field>
            )}

            <div className="flex flex-col gap-3">
              <Button type="submit" disabled={isPending}>
                {isPending && <Spinner />}

                {localization.auth.resetPassword}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            {localization.auth.rememberYourPassword}{" "}
            <Link
              href={getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, redirectTo)}
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
