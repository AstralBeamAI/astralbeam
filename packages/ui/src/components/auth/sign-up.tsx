// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/sign-up`
// Local edits: Keeps sign-up OAuth-only, links to configurable legal documents, requires explicit terms acceptance, accepts a route-stable redirect target, sends the accepted terms version through OAuth, and supports new-user onboarding redirects.

"use client"

import { getAuthLinkURL } from "@better-auth-ui/core"
import { AuthPrompts, useAuth } from "@better-auth-ui/react"
import { useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/card"
import { Checkbox } from "@/components/checkbox"
import { cn } from "@/lib/utils"
import { ProviderButtons, type SocialLayout } from "./provider-buttons"

export interface SignUpProps {
  className?: string
  socialLayout?: SocialLayout
  termsVersion: string
  termsUrl: string
  privacyUrl: string
  newUserRedirectTo?: string
  redirectTo?: string
}

export function SignUp({
  className,
  newUserRedirectTo,
  privacyUrl,
  redirectTo: redirectToProp,
  socialLayout,
  termsUrl,
  termsVersion,
}: SignUpProps) {
  const {
    basePaths,
    Link,
    localization,
    redirectTo: configuredRedirectTo,
    socialProviders,
    viewPaths,
  } = useAuth()
  const redirectTo = redirectToProp ?? configuredRedirectTo
  const [termsAccepted, setTermsAccepted] = useState(false)

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <AuthPrompts view="signUp" />
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{localization.auth.signUp}</CardTitle>
        <CardDescription>Accept the terms, then choose an account to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          <label
            className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"
            htmlFor="accept-terms"
          >
            <Checkbox
              aria-describedby="terms-description"
              checked={termsAccepted}
              id="accept-terms"
              onCheckedChange={setTermsAccepted}
            />
            <span id="terms-description">
              I accept AstralBeam&apos;s{" "}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href={termsUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Terms of Service
              </a>{" "}
              and acknowledge the{" "}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href={privacyUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>

          {socialProviders?.length ? (
            <fieldset disabled={!termsAccepted}>
              <legend className="sr-only">Choose an account provider</legend>
              <ProviderButtons
                newUserRedirectTo={newUserRedirectTo}
                redirectTo={redirectTo}
                socialLayout={socialLayout ?? "auto"}
                termsVersion={termsAccepted ? termsVersion : undefined}
                view="signUp"
              />
            </fieldset>
          ) : (
            <output className="text-sm text-muted-foreground">
              No sign-up providers are available.
            </output>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              className="font-medium text-foreground underline underline-offset-4"
              href={getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, redirectTo)}
            >
              Sign in
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
