// Added from @better-auth-ui/auth
// Local changes: Add configured CAPTCHA; use Base UI Toast/browser-safe globals, preserve the return path, render a semantic page heading, and show the stored recipient with a correction link once hydrated. Use TanStack hydration readiness. Improve onboarding copy, layout, and form guidance. Keep verification usable when browser storage is blocked. Support manual verification for the signed-in recipient.

"use client"

import { getAuthLinkURL } from "@better-auth-ui/core"
import {
  useAuth,
  useFetchOptions,
  useSendVerificationEmail,
  useSession,
} from "@better-auth-ui/react"
import { useEffect, useState } from "react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldDescription } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "cn"
import { OpenEmailButton } from "./open-email-button"
import { useHydrated } from "@tanstack/react-router"

export type VerifyEmailProps = {
  className?: string
}

/** Seconds the resend button stays disabled to prevent spamming the endpoint. */
const RESEND_COOLDOWN_SECONDS = 60

/**
 * Render a card prompting the user to verify their email, with a resend button
 * that is rate-limited by a cooldown timer.
 *
 * The target email comes from the signed-in session or `sessionStorage` (set when signup/sign-in
 * redirects here); the OpenEmail/Resend controls are only shown when an email
 * is stored. The resend button is disabled while a cooldown is active and shows
 * the remaining seconds.
 *
 * @param className - Additional CSS classes applied to the card
 * @returns The verify-email card React element
 */
export function VerifyEmail({ className }: VerifyEmailProps) {
  const { authClient, basePaths, baseURL, localization, plugins, redirectTo, viewPaths, Link } =
    useAuth()
  const { fetchOptions, resetFetchOptions } = useFetchOptions()
  const session = useSession(authClient)

  const isHydrated = useHydrated()
  let email = session.data?.user.email || ""
  if (isHydrated && !email) {
    try {
      email = globalThis.sessionStorage.getItem("better-auth-ui.verify-email") || ""
    } catch {
      // Verification links and sign-in remain available without the stored recipient hint.
    }
  }
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS)
  const [verificationRequested, setVerificationRequested] = useState(false)
  const initialRequest = Boolean(session.data) && !verificationRequested

  useEffect(() => {
    if (cooldown <= 0 || !email || initialRequest) return

    const interval = setInterval(() => {
      setCooldown((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [cooldown, email, initialRequest])

  const { mutate: sendVerificationEmail, isPending } = useSendVerificationEmail(authClient, {
    onError: () => {
      resetFetchOptions()
    },
    onSuccess: () => {
      resetFetchOptions()
      toast.add({ title: localization.auth.verificationEmailSent, type: "success" })
      setVerificationRequested(true)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    },
  })

  const isCoolingDown = cooldown > 0 && !initialRequest
  const captchaComponent = plugins?.find((plugin) => plugin.id === "captcha")?.captchaComponent
  const captchaReady = !captchaComponent || Boolean(fetchOptions?.headers?.["x-captcha-response"])

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">
          <h1>{localization.auth.verifyEmail}</h1>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-4">
          <FieldDescription>
            {initialRequest
              ? "Send a verification link to your email address to continue."
              : "Open the verification link in your email to continue. It expires in one hour."}
          </FieldDescription>

          {email && (
            <div className="flex flex-col gap-3">
              <p className="break-all text-sm font-medium">{email}</p>
              {!initialRequest && (
                <p className="text-sm text-muted-foreground">
                  No email yet? Check your spam folder, or resend the link below.
                </p>
              )}
              <OpenEmailButton email={email} />

              <Button
                type="button"
                variant="outline"
                disabled={!email || isCoolingDown || isPending || !captchaReady}
                onClick={() =>
                  sendVerificationEmail({
                    email,
                    callbackURL: `${baseURL}${redirectTo}`,
                    fetchOptions,
                  })
                }
              >
                {isPending && <Spinner />}

                {isCoolingDown
                  ? localization.auth.resendIn.replace("{{seconds}}", String(cooldown))
                  : initialRequest
                    ? "Send verification email"
                    : localization.auth.resend}
              </Button>

              {captchaComponent}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <Link
            href={getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signUp}`, redirectTo)}
            className="text-sm underline underline-offset-4"
          >
            Use a different email
          </Link>
          <FieldDescription className="text-center">
            {localization.auth.alreadyVerifiedYourEmail}{" "}
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
