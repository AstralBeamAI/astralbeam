import { buttonVariants } from "@astralbeam/ui/components/button"
import { authSessionQueryOptions } from "@astralbeam/auth/tanstack/queries"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

const signInParams = { path: "sign-in" }
const signUpParams = { path: "sign-up" }

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData({
      ...authSessionQueryOptions,
      revalidateIfStale: true,
    })
    if (session) throw redirect({ to: "/dashboard" })
  },
  component: HomePage,
})

function HomePage() {
  return (
    <main className="flex min-h-svh items-center p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div className="space-y-1">
          <p className="text-muted-foreground">AstralBeam</p>
          <h1 className="font-heading text-2xl font-medium">Authentication is ready.</h1>
          <p className="text-muted-foreground">
            Sign in to an existing account or accept the terms before creating a new one.
          </p>
        </div>
        <div className="flex gap-2">
          <Link className={buttonVariants()} params={signInParams} to="/auth/$path">
            Sign in
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            params={signUpParams}
            to="/auth/$path"
          >
            Sign up
          </Link>
          <Link className={buttonVariants({ variant: "ghost" })} to="/dashboard">
            Open dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
