import { createFileRoute } from "@tanstack/react-router"

import { Organizations } from "@/components/auth/organization/organizations"
import { UserInvitations } from "@/components/auth/organization/user-invitations"
import { APP_NAME } from "@/lib/constants"

export const Route = createFileRoute("/_authenticated/organizations/")({
  component: OrganizationsRoute,
  head: () => ({ meta: [{ title: `Organizations · ${APP_NAME}` }] }),
})

function OrganizationsRoute() {
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Organizations
          </h1>
          <p className="text-sm text-muted-foreground">
            Open an organization, accept a pending invitation, or create a new one.
          </p>
        </div>
        <div className="flex flex-col gap-4 md:gap-6">
          <Organizations />
          <UserInvitations />
        </div>
      </div>
    </main>
  )
}
