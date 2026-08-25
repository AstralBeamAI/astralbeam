// Added with: deno task ui add @better-auth-ui/settings
// Local changes: remove the unconfigured two-factor continuation branch, choose reauthentication from the user's actual accounts, preserve the return path, and keep credential errors non-sensitive.

"use client"

import { getAuthLinkURL, getSafeRedirectTo } from "@better-auth-ui/core"
import { useAuth, useListAccounts, useSession, useSignInEmail } from "@better-auth-ui/react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export interface FreshSessionPromptProps {
  onFresh: () => unknown | Promise<unknown>
}

export function FreshSessionPrompt({ onFresh }: FreshSessionPromptProps) {
  const auth = useAuth()
  const session = useSession(auth.authClient)
  const accounts = useListAccounts(auth.authClient)
  const hasCredentialAccount = accounts.data?.some(
    (account) => account.providerId === "credential",
  ) ?? false
  const [password, setPassword] = useState("")
  const signIn = useSignInEmail(auth.authClient, {
    meta: { errorPresentation: "inline" },
    onError: () => setPassword(""),
    onSuccess: async () => {
      setPassword("")
      await onFresh()
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = session.data?.user.email
    if (!email) return
    signIn.mutate({ email, password })
  }

  const signInAgain = () => {
    const returnPath = getSafeRedirectTo(
      `${globalThis.location.pathname}${globalThis.location.search}`,
      globalThis.location.origin,
    )
    const link = new URL(
      getAuthLinkURL(
        `${auth.basePaths.auth}/${auth.viewPaths.auth.signIn}`,
        returnPath,
      ),
      globalThis.location.origin,
    )
    link.searchParams.set("fresh", "true")
    auth.navigate({ to: `${link.pathname}${link.search}` })
  }

  return (
    <div className="p-4">
      <FieldGroup className="gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            {auth.localization.settings.freshSessionTitle}
          </h3>
          <FieldDescription>
            {auth.localization.settings.freshSessionDescription}
          </FieldDescription>
        </div>
        {accounts.isPending
          ? <Spinner aria-label="Loading sign-in methods" />
          : auth.emailAndPassword?.enabled && hasCredentialAccount
          ? (
            <form className="flex flex-col gap-3" onSubmit={submit}>
              <Field data-invalid={signIn.isError}>
                <FieldLabel htmlFor="fresh-session-password">
                  {auth.localization.auth.password}
                </FieldLabel>
                <Input
                  id="fresh-session-password"
                  autoComplete="current-password"
                  disabled={signIn.isPending}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  required
                />
                {signIn.error && (
                  <FieldError>
                    Your password could not be verified. Please try again.
                  </FieldError>
                )}
              </Field>
              <Button disabled={!password || signIn.isPending} type="submit">
                {signIn.isPending && <Spinner />}
                {auth.localization.settings.freshSessionSubmit}
              </Button>
            </form>
          )
          : (
            <Button
              onClick={signInAgain}
            >
              {auth.localization.settings.freshSessionSignIn}
            </Button>
          )}
      </FieldGroup>
    </div>
  )
}
