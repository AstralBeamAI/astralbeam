// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/sign-in`
// Local edits: Keeps this component OAuth-only, removes unused credential flows, accepts a route-stable redirect target, and links explicitly to the separate sign-up page.

"use client"

import { getAuthLinkURL } from "@better-auth-ui/core"
import { AuthPrompts, useAuth } from "@better-auth-ui/react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/card"
import { cn } from "@/lib/utils"
import { ProviderButtons, type SocialLayout } from "./provider-buttons"

export type SignInProps = {
  className?: string
  redirectTo?: string
  socialLayout?: SocialLayout
}

export function SignIn({ className, redirectTo: redirectToProp, socialLayout }: SignInProps) {
  const {
    basePaths,
    Link,
    localization,
    redirectTo: configuredRedirectTo,
    socialProviders,
    viewPaths,
  } = useAuth()
  const redirectTo = redirectToProp ?? configuredRedirectTo

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <AuthPrompts view="signIn" />
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{localization.auth.signIn}</CardTitle>
        <CardDescription>Choose an account to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          {socialProviders?.length ? (
            <ProviderButtons
              redirectTo={redirectTo}
              socialLayout={socialLayout ?? "auto"}
              view="signIn"
            />
          ) : (
            <output className="text-sm text-muted-foreground">
              No sign-in providers are available.
            </output>
          )}
          <p className="text-center text-sm text-muted-foreground">
            Need to create an account?{" "}
            <Link
              className="font-medium text-foreground underline underline-offset-4"
              href={getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signUp}`, redirectTo)}
            >
              Sign up
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
