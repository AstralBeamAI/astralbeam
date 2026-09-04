// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Keep failed sign-outs retryable with a non-sensitive inline error state.
import { useAuth, useSignOut } from "@better-auth-ui/react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "cn"

export type SignOutProps = {
  className?: string
}

/**
 * Signs the current user out on mount and renders a centered spinner while the operation completes.
 *
 * @param className - Optional additional class names appended to the root element
 * @returns The spinner shown during sign-out
 */
export function SignOut({ className }: SignOutProps) {
  const { authClient, basePaths, localization, navigate, viewPaths } = useAuth()

  const signOutMutation = useSignOut(authClient, {
    onSuccess: () =>
      navigate({
        to: `${basePaths.auth}/${viewPaths.auth.signIn}`,
        replace: true,
      }),
  })

  const hasSignedOut = useRef(false)

  useEffect(() => {
    if (hasSignedOut.current) return
    hasSignedOut.current = true

    signOutMutation.mutate()
  }, [signOutMutation.mutate])

  if (signOutMutation.error) {
    return (
      <Card className={cn("w-full max-w-sm", className)}>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">
            <h1>We couldn&apos;t sign you out</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Your session may still be active. Please try again.
          </p>
          <Button
            type="button"
            disabled={signOutMutation.isPending}
            onClick={() => {
              signOutMutation.reset()
              signOutMutation.mutate()
            }}
          >
            {signOutMutation.isPending && <Spinner />}
            {localization.auth.signOut}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return <Spinner className={cn("mx-auto my-auto", className)} />
}
