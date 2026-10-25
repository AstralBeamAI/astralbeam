// Added from @better-auth-ui/auth
// Local changes: Show invitation context and prefill the invited email. Add the legal gate for email/OAuth signup and configured CAPTCHA, preserve the verification return path when browser storage is unavailable, remove generic additional fields and unconfigured plugin buttons, send only a boolean assertion, use Phosphor/Base UI Toast and domain-specific function names, repair strict typing, and read legal URLs from the runtime public config instead of build-time constants. Share password visibility controls. Wait for hydration, prevent duplicate submissions, trim and require visible names, and show password requirements. Use useIsClient for client readiness.

"use client"

import { authMutationKeys, getAuthLinkURL, isPasswordCompromisedError } from "@better-auth-ui/core"
import { AuthPrompts, useAuth, useFetchOptions, useSignUpEmail } from "@better-auth-ui/react"
import { useIsMutating } from "@tanstack/react-query"
import { type SyntheticEvent, useRef, useState } from "react"
import { toast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { PasswordInput } from "@/components/auth/password-input"
import { Spinner } from "@/components/ui/spinner"
import { usePublicConfig } from "@/components/public-config-provider"
import { getInvitationContext } from "@/lib/auth/redirect"
import { cn } from "cn"
import { PasswordStrengthMeter } from "./password-strength-meter"
import { ProviderButtons, type SocialLayout } from "./provider-buttons"
import { useIsClient } from "usehooks-ts"

export type SignUpProps = {
  className?: string
  socialLayout?: SocialLayout
  socialPosition?: "top" | "bottom"
  /**
   * Runs instead of the post-sign-up redirect, but only when the sign-up
   * created an immediately usable session. Email verification still takes
   * priority, and social sign-ups are unaffected.
   */
  onSignUpSuccess?: () => void
}

/**
 * Renders a sign-up form with name, email, and password fields, optional social provider buttons, and submission handling.
 *
 * Submits credentials to the configured auth client and handles the response:
 * - If email verification is required, shows a notification and navigates to sign-in
 * - On success, refreshes the session and navigates to the configured redirect path
 * - On failure, displays error toasts
 * - Manages a pending state while the request is in-flight
 *
 * @param className - Additional CSS classes applied to the outer container
 * @param socialLayout - Social layout to apply to the component
 * @param socialPosition - Social position to apply to the component
 * @param onSignUpSuccess - Replaces the post-sign-up redirect when the new account is immediately usable
 * @returns The sign-up form React element.
 */
export function SignUp({
  className,
  socialLayout,
  socialPosition = "bottom",
  onSignUpSuccess,
}: SignUpProps) {
  const {
    authClient,
    basePaths,
    emailAndPassword,
    localization,
    plugins,
    redirectTo,
    socialProviders,
    viewPaths,
    navigate,
    Link,
  } = useAuth()
  const { privacyPolicyUrl, termsOfServiceUrl } = usePublicConfig()
  const legalLinks = [
    termsOfServiceUrl ? { href: termsOfServiceUrl, label: "Terms of Service" } : null,
    privacyPolicyUrl ? { href: privacyPolicyUrl, label: "Privacy Policy" } : null,
  ].filter((link) => link !== null)
  const legalAcceptanceRequired = legalLinks.length > 0

  const invitation = getInvitationContext(redirectTo)

  const { fetchOptions, resetFetchOptions } = useFetchOptions()
  const isClient = useIsClient()
  const signUpSubmitting = useRef(false)

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [termsAccepted, setTermsAccepted] = useState(false)
  const legalAccepted = !legalAcceptanceRequired || termsAccepted

  const { mutate: signUpEmail, isPending: signUpEmailPending } = useSignUpEmail(authClient, {
    onError: (error) => {
      // The haveIBeenPwned plugin rejects on the password itself,
      // so it belongs against the field rather than in a toast.
      if (isPasswordCompromisedError(error)) {
        setFieldErrors((prev) => ({
          ...prev,
          password: localization.auth.passwordCompromised,
        }))
      }

      setPassword("")
      setConfirmPassword("")
      resetFetchOptions()
    },
    onSuccess: (_data, { email }) => {
      if (emailAndPassword?.requireEmailVerification) {
        try {
          globalThis.sessionStorage.setItem("better-auth-ui.verify-email", email)
        } catch {
          // The stored email is only a convenience for the verification view.
        }
        navigate({
          to: getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.verifyEmail}`, redirectTo),
        })
      } else if (onSignUpSuccess) {
        onSignUpSuccess()
      } else {
        navigate({ to: redirectTo })
      }
    },
    onSettled: () => {
      signUpSubmitting.current = false
    },
  })

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  })
  const isPending = !isClient || signUpEmailPending || signInMutating > 0

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string | undefined
    email?: string | undefined
    password?: string | undefined
    confirmPassword?: string | undefined
  }>({})

  const submitSignUp = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (isPending || signUpSubmitting.current) return

    if (!legalAccepted) {
      globalThis.document.querySelector<HTMLElement>("#accept-legal")?.focus()
      return
    }

    const formData = new FormData(e.currentTarget)
    // `emailAndPassword.name === false` hides the name field and submits "".
    const name = ((formData.get("name") as string | null) ?? "").trim()
    const email = formData.get("email") as string

    if (emailAndPassword?.confirmPassword && password !== confirmPassword) {
      toast.add({ title: localization.auth.passwordsDoNotMatch, type: "error" })
      setPassword("")
      setConfirmPassword("")
      return
    }

    signUpSubmitting.current = true
    signUpEmail({
      name,
      email,
      password,
      callbackURL: redirectTo,
      fetchOptions,
      ...(legalAcceptanceRequired && { termsAccepted: true as const }),
    })
  }

  const showSeparator = emailAndPassword?.enabled && socialProviders && socialProviders.length > 0
  const captchaComponent = plugins?.find((plugin) => plugin.id === "captcha")?.captchaComponent
  const captchaReady = !captchaComponent || Boolean(fetchOptions?.headers?.["x-captcha-response"])
  const providerButtons = socialProviders?.length ? (
    <ProviderButtons
      disabled={isPending || !legalAccepted}
      {...(socialLayout === undefined ? {} : { socialLayout })}
      {...(legalAcceptanceRequired ? { termsAccepted } : {})}
      view="signUp"
    />
  ) : null

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <AuthPrompts view="signUp" />
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          <h1>{localization.auth.signUp}</h1>
        </CardTitle>
        {invitation && (
          <CardDescription>
            Create an account to join {invitation.organization}. Use{" "}
            {invitation.email || "the email address that received the invitation"}.
          </CardDescription>
        )}
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-6">
          {!isClient && <p role="status">Loading sign-up form…</p>}
          {socialPosition === "top" && (
            <>
              {providerButtons}

              {showSeparator && (
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card text-xs flex items-center">
                  {localization.auth.or}
                </FieldSeparator>
              )}
            </>
          )}

          {emailAndPassword?.enabled && (
            <form onSubmit={submitSignUp}>
              <FieldGroup>
                {emailAndPassword.name !== false && (
                  <Field data-invalid={!!fieldErrors.name}>
                    <FieldLabel htmlFor="name">{localization.auth.name}</FieldLabel>

                    <Input
                      id="name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      placeholder={localization.auth.namePlaceholder}
                      required
                      pattern=".*\S.*"
                      disabled={isPending}
                      onChange={() => {
                        setFieldErrors((prev) => ({
                          ...prev,
                          name: undefined,
                        }))
                      }}
                      onInvalid={(e) => {
                        e.preventDefault()

                        setFieldErrors((prev) => ({
                          ...prev,
                          name: localization.auth.fieldRequired,
                        }))
                      }}
                      aria-invalid={!!fieldErrors.name}
                      aria-describedby={fieldErrors.name ? "signup-name-error" : undefined}
                    />

                    <FieldError id="signup-name-error">{fieldErrors.name}</FieldError>
                  </Field>
                )}

                <Field data-invalid={!!fieldErrors.email}>
                  <FieldLabel htmlFor="email">{localization.auth.email}</FieldLabel>

                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={invitation?.email}
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
                  <FieldLabel htmlFor="password">{localization.auth.password}</FieldLabel>

                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete="new-password"
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
                          ? localization.auth.tooShort.replace("{{min}}", String(min))
                          : localization.auth.tooLong.replace("{{max}}", String(max))

                      setFieldErrors((prev) => ({
                        ...prev,
                        password: msg,
                      }))
                    }}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby="signup-password-requirements"
                  />

                  <FieldDescription id="signup-password-requirements">
                    Use {emailAndPassword.minPasswordLength}–{emailAndPassword.maxPasswordLength}{" "}
                    characters.
                  </FieldDescription>
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
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)

                        setFieldErrors((prev) => ({
                          ...prev,
                          confirmPassword: undefined,
                        }))
                      }}
                      placeholder={localization.auth.confirmPasswordPlaceholder}
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

                {legalAcceptanceRequired && (
                  <Field orientation="horizontal">
                    <Checkbox
                      id="accept-legal"
                      checked={termsAccepted}
                      onCheckedChange={(checked) => setTermsAccepted(checked)}
                      aria-labelledby="accept-legal-copy"
                      required
                      disabled={isPending}
                    />
                    <p id="accept-legal-copy" className="text-sm text-muted-foreground">
                      <label htmlFor="accept-legal" className="cursor-pointer">
                        I accept the{" "}
                      </label>
                      {legalLinks.map((link, index) => (
                        <span key={link.label}>
                          {index > 0 && " and "}
                          <a
                            href={link.href}
                            className="font-medium text-foreground underline underline-offset-4"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {link.label}
                          </a>
                        </span>
                      ))}
                      .
                    </p>
                  </Field>
                )}

                {captchaComponent}

                <div className="flex flex-col gap-3">
                  <Button type="submit" disabled={isPending || !legalAccepted || !captchaReady}>
                    {signUpEmailPending && <Spinner />}

                    {localization.auth.signUp}
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

              {providerButtons}
            </>
          )}
        </div>

        {emailAndPassword?.enabled && (
          <div className="flex flex-col gap-3 items-center w-full mt-4">
            <FieldDescription className="text-center">
              {localization.auth.alreadyHaveAnAccount}{" "}
              <Link
                href={getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, redirectTo)}
                className="underline underline-offset-4"
              >
                {localization.auth.signIn}
              </Link>
            </FieldDescription>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
