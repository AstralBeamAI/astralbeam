import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button"
import { getActiveOrganizationMembership, getSession } from "@/server/session.functions"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (!(await getSession())) return
    const membership = await getActiveOrganizationMembership()
    throw redirect({ to: membership?.member ? "/dashboard" : "/onboarding" })
  },
  component: Home,
})

function Home() {
  return (
    <main className="flex min-h-svh items-center bg-[radial-gradient(circle_at_top_left,var(--color-primary)/0.12,transparent_42%)] p-6">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <img alt="AstralBeam" className="h-10 w-auto" src="/astralbeam-wordmark-light.svg" />
        <div className="max-w-3xl space-y-5">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
            Open source agent infrastructure
          </p>
          <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
            Ship agents in minutes, not months.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Authenticate with Google or GitHub, create an organization, and provision role-based
            access from one workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className={buttonVariants()} to="/auth/$path" params={{ path: "sign-up" }}>
            Create an account
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            to="/auth/$path"
            params={{ path: "sign-in" }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  )
}
