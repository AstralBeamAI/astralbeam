import astralbeamLightLogoUrl from "@astralbeam/brand/logo/svg/astralbeam-logo-light.svg?url&no-inline"
import { authSessionQueryOptions } from "@astralbeam/auth/tanstack/queries"
import { CURRENT_TERMS_VERSION } from "@astralbeam/auth/terms"
import { SignIn } from "@astralbeam/ui/components/auth/sign-in"
import { SignOut } from "@astralbeam/ui/components/auth/sign-out"
import { SignUp } from "@astralbeam/ui/components/auth/sign-up"
import { Alert, AlertDescription, AlertTitle } from "@astralbeam/ui/components/alert"
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"

const authPaths = new Set(["sign-in", "sign-out", "sign-up"])
const privacyUrl = import.meta.env.VITE_PRIVACY_POLICY_URL
const termsUrl = import.meta.env.VITE_TERMS_OF_SERVICE_URL
// Better Auth returns this OAuth callback error when implicit sign-up is disabled for a new account. https://better-auth.com/docs/concepts/oauth#disablesignup
const signUpRequiredError = "signup_disabled"
const authErrorMessages = new Map([
  [
    "access_denied",
    "Authorization was canceled. Choose a provider when you are ready to continue.",
  ],
  ["email_is_missing", "The provider did not return an email address for this account."],
  ["email_not_found", "The provider did not return an email address for this account."],
  ["state_not_found", "This sign-in attempt expired. Please start again."],
  ["TERMS_NOT_ACCEPTED", "Accept the current Terms of Service before creating an account."],
])
const fallbackAuthErrorMessage = "We could not complete authentication. Please try again."

type AuthSearch = {
  error?: string | undefined
  redirectTo?: string | undefined
}

function normalizeRedirectTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined

  try {
    const origin = "https://astralbeam.invalid"
    const target = new URL(value, origin)
    return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : undefined
  } catch {
    return undefined
  }
}

function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  return {
    error: typeof search.error === "string" ? search.error : undefined,
    redirectTo: normalizeRedirectTo(search.redirectTo),
  }
}

function getAuthErrorMessage(error: string | undefined) {
  return error ? (authErrorMessages.get(error) ?? fallbackAuthErrorMessage) : undefined
}

export const Route = createFileRoute("/auth/$path")({
  validateSearch: validateAuthSearch,
  beforeLoad: async ({ context, params, search }) => {
    if (!authPaths.has(params.path)) throw notFound()

    if (params.path === "sign-in" && search.error === signUpRequiredError) {
      throw redirect({
        to: "/auth/$path",
        params: { path: "sign-up" },
        search: search.redirectTo ? { redirectTo: search.redirectTo } : {},
        replace: true,
      })
    }

    if (params.path === "sign-in" || params.path === "sign-up") {
      const session = await context.queryClient.ensureQueryData({
        ...authSessionQueryOptions,
        revalidateIfStale: true,
      })
      if (session) throw redirect({ to: "/dashboard" })
    }
  },
  component: AuthPage,
})

function AuthPage() {
  const { path } = Route.useParams()
  const { error, redirectTo = "/dashboard" } = Route.useSearch()
  const errorMessage = getAuthErrorMessage(error)

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-4">
        <Link aria-label="AstralBeam home" className="block w-fit" to="/">
          <img alt="AstralBeam" className="h-8 w-auto" src={astralbeamLightLogoUrl} />
        </Link>
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Authentication failed</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {path === "sign-out" ? (
          <SignOut />
        ) : path === "sign-up" ? (
          <SignUp
            className="max-w-none"
            newUserRedirectTo="/onboarding"
            privacyUrl={privacyUrl}
            redirectTo={redirectTo}
            termsUrl={termsUrl}
            termsVersion={CURRENT_TERMS_VERSION}
          />
        ) : (
          <SignIn className="max-w-none" redirectTo={redirectTo} />
        )}
      </div>
    </main>
  )
}
