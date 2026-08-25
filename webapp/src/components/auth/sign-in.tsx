// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Use Phosphor icons, browser-safe globals, and domain-specific function names; remove unconfigured passkey, last-login, two-factor, CAPTCHA, and plugin buttons; preserve return paths when browser storage is unavailable, strict typing, and a semantic heading.

"use client"

import { authMutationKeys, getAuthLinkURL } from "@better-auth-ui/core"
import { AuthPrompts, useAuth, useFetchOptions, useSignInEmail } from "@better-auth-ui/react"
import { useIsMutating } from "@tanstack/react-query"
import { EyeIcon as Eye, EyeSlashIcon as EyeOff } from "@phosphor-icons/react"
import { type SyntheticEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { ProviderButtons, type SocialLayout } from "./provider-buttons"

export type SignInProps = {
  className?: string
  socialLayout?: SocialLayout
  socialPosition?: "top" | "bottom"
}

/**
 * Render the sign-in form UI with email/password and social provider options.
 *
 * @param className - Optional additional container class names
 * @param socialLayout - Layout style for social provider buttons
 * @param socialPosition - Position of social provider buttons; `"top"` or `"bottom"`. Defaults to `"bottom"`.
 * @returns The rendered sign-in UI as a JSX element
 */
export function SignIn({
  className,
  socialLayout,
  socialPosition = "bottom",
}: SignInProps) {
  const {
    authClient,
    basePaths,
    emailAndPassword,
    localization,
    redirectTo,
    socialProviders,
    viewPaths,
    navigate,
    Link,
  } = useAuth()

  const { fetchOptions, resetFetchOptions } = useFetchOptions()

  const [password, setPassword] = useState("")

  const { mutate: signInEmail, isPending: signInEmailPending } = useSignInEmail(
    authClient,
    {
      onError: (error, { email }) => {
        setPassword("")

        if (error.error?.code === "EMAIL_NOT_VERIFIED") {
          try {
            globalThis.sessionStorage.setItem(
              "better-auth-ui.verify-email",
              email,
            )
          } catch {
            // The stored email is only a convenience for the verification view.
          }
          navigate({
            to: getAuthLinkURL(
              `${basePaths.auth}/${viewPaths.auth.verifyEmail}`,
              redirectTo,
            ),
          })
        }

        resetFetchOptions()
      },
      onSuccess: () => navigate({ to: redirectTo }),
    },
  )

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  })
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  })
  const isPending = signInMutating + signUpMutating > 0

  const [isPasswordVisible, setIsPasswordVisible] = useState(false)

  const [fieldErrors, setFieldErrors] = useState<{
    email: string | undefined
    password: string | undefined
  }>({ email: undefined, password: undefined })

  const providerButtonsProps = socialLayout === undefined ? {} : { socialLayout }

  const submitSignIn = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const rememberMe = formData.get("rememberMe") === "on"

    signInEmail({
      email,
      password,
      ...(emailAndPassword?.rememberMe ? { rememberMe } : {}),
      fetchOptions,
    })
  }

  const showSeparator = emailAndPassword?.enabled && socialProviders && socialProviders.length > 0

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <AuthPrompts view="signIn" />
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          <h1>{localization.auth.signIn}</h1>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-6">
          {socialPosition === "top" && (
            <>
              {socialProviders && socialProviders.length > 0 && (
                <ProviderButtons {...providerButtonsProps} view="signIn" />
              )}

              {showSeparator && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card m-0 text-xs flex items-center">
                  {localization.auth.or}
                </FieldSeparator>
              )}
            </>
          )}

          {emailAndPassword?.enabled && (
            <form onSubmit={submitSignIn}>
              <FieldGroup>
                <Field data-invalid={!!fieldErrors.email}>
                  <FieldLabel htmlFor="email">
                    {localization.auth.email}
                  </FieldLabel>

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

                <Field data-invalid={!!fieldErrors.password}>
                  <FieldLabel htmlFor="password">
                    {localization.auth.password}
                  </FieldLabel>

                  <InputGroup>
                    <InputGroupInput
                      id="password"
                      name="password"
                      type={isPasswordVisible ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)

                        setFieldErrors((prev) => ({
                          ...prev,
                          password: undefined,
                        }))
                      }}
                      placeholder={localization.auth.passwordPlaceholder}
                      required
                      minLength={emailAndPassword?.minPasswordLength}
                      maxLength={emailAndPassword?.maxPasswordLength}
                      disabled={isPending}
                      onInvalid={(e) => {
                        e.preventDefault()
                        const el = e.target as HTMLInputElement
                        const min = emailAndPassword?.minPasswordLength
                        const max = emailAndPassword?.maxPasswordLength
                        const msg = el.validity.valueMissing
                          ? localization.auth.fieldRequired
                          : el.validity.tooShort
                          ? localization.auth.tooShort.replace(
                            "{{min}}",
                            String(min),
                          )
                          : localization.auth.tooLong.replace(
                            "{{max}}",
                            String(max),
                          )

                        setFieldErrors((prev) => ({
                          ...prev,
                          password: msg,
                        }))
                      }}
                      aria-invalid={!!fieldErrors.password}
                    />

                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        aria-label={isPasswordVisible
                          ? localization.auth.hidePassword
                          : localization.auth.showPassword}
                        title={isPasswordVisible
                          ? localization.auth.hidePassword
                          : localization.auth.showPassword}
                        onClick={() => {
                          setIsPasswordVisible((visible) => !visible)
                        }}
                      >
                        {isPasswordVisible ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>

                  <FieldError>{fieldErrors.password}</FieldError>
                </Field>

                {emailAndPassword.rememberMe && (
                  <Field className="my-1">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="rememberMe"
                        name="rememberMe"
                        disabled={isPending}
                      />

                      <FieldLabel
                        htmlFor="rememberMe"
                        className="cursor-pointer text-sm font-normal"
                      >
                        {localization.auth.rememberMe}
                      </FieldLabel>
                    </div>
                  </Field>
                )}

                <div className="flex flex-col gap-3">
                  <Button
                    type="submit"
                    disabled={isPending}
                  >
                    {signInEmailPending && <Spinner />}

                    {localization.auth.signIn}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          )}

          {socialPosition === "bottom" && (
            <>
              {showSeparator && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card text-xs flex items-center">
                  {localization.auth.or}
                </FieldSeparator>
              )}

              {socialProviders && socialProviders.length > 0 && (
                <ProviderButtons {...providerButtonsProps} view="signIn" />
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          {emailAndPassword?.enabled && emailAndPassword?.forgotPassword && (
            <Link
              href={getAuthLinkURL(
                `${basePaths.auth}/${viewPaths.auth.forgotPassword}`,
                redirectTo,
              )}
              className="self-center text-sm underline-offset-4 hover:underline"
            >
              {localization.auth.forgotPasswordLink}
            </Link>
          )}

          {emailAndPassword?.enabled && (
            <FieldDescription className="text-center">
              {localization.auth.needToCreateAnAccount}{" "}
              <Link
                href={getAuthLinkURL(
                  `${basePaths.auth}/${viewPaths.auth.signUp}`,
                  redirectTo,
                )}
                className="underline underline-offset-4"
              >
                {localization.auth.signUp}
              </Link>
            </FieldDescription>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
