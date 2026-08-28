// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Add configured CAPTCHA; use Base UI Toast/browser-safe globals, preserve the return path, and render a semantic page heading.

"use client"

import { getAuthLinkURL } from "@better-auth-ui/core"
import { useAuth, useFetchOptions, useSendVerificationEmail } from "@better-auth-ui/react"
import { useEffect, useState } from "react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldDescription } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { OpenEmailButton } from "./open-email-button"
import { useIsHydrated } from "./use-is-hydrated"

export type VerifyEmailProps = {
  className?: string
}

/** Seconds the resend button stays disabled to prevent spamming the endpoint. */
const RESEND_COOLDOWN_SECONDS = 60

/**
 * Render a card prompting the user to verify their email, with a resend button
 * that is rate-limited by a cooldown timer.
 *
 * The target email is read from `sessionStorage` (set when sign-up or sign-in
 * redirects here); the OpenEmail/Resend controls are only shown when an email
 * is stored. The resend button is disabled while a cooldown is active and shows
 * the remaining seconds.
 *
 * @param className - Additional CSS classes applied to the card
 * @returns The verify-email card React element
 */
export function VerifyEmail({ className }: VerifyEmailProps) {
  const {
    authClient,
    basePaths,
    baseURL,
    localization,
    plugins,
    redirectTo,
    viewPaths,
    Link,
  } = useAuth()
  const { fetchOptions, resetFetchOptions } = useFetchOptions()

  const isHydrated = useIsHydrated()
  const [email, setEmail] = useState(
    (isHydrated &&
      globalThis.sessionStorage.getItem("better-auth-ui.verify-email")) ||
      "",
  )
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS)

  useEffect(() => {
    setEmail(
      globalThis.sessionStorage.getItem("better-auth-ui.verify-email") ?? "",
    )
  }, [])

  useEffect(() => {
    if (cooldown <= 0 || !email) return

    const interval = setInterval(() => {
      setCooldown((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [cooldown, email])

  const { mutate: sendVerificationEmail, isPending } = useSendVerificationEmail(
    authClient,
    {
      onError: () => {
        resetFetchOptions()
      },
      onSuccess: () => {
        resetFetchOptions()
        toast.add({ title: localization.auth.verificationEmailSent, type: "success" })
        setCooldown(RESEND_COOLDOWN_SECONDS)
      },
    },
  )

  const isCoolingDown = cooldown > 0
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
            {localization.auth.checkYourEmail}
          </FieldDescription>

          {email && (
            <div className="flex flex-col gap-3">
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
                  })}
              >
                {isPending && <Spinner />}

                {isCoolingDown
                  ? localization.auth.resendIn.replace(
                    "{{seconds}}",
                    String(cooldown),
                  )
                  : localization.auth.resend}
              </Button>

              {captchaComponent}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 items-center w-full mt-4">
          <FieldDescription className="text-center">
            {localization.auth.alreadyVerifiedYourEmail}{" "}
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
