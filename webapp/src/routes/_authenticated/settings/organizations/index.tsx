import { createFileRoute } from "@tanstack/react-router"

import { Settings } from "@/components/auth/settings/settings"

export const Route = createFileRoute(
  "/_authenticated/settings/organizations/",
)({
  component: OrganizationsSettingsRoute,
})

function OrganizationsSettingsRoute() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Organizations
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your organizations and pending invitations.
        </p>
      </div>
      <Settings view="organizations" />
    </div>
  )
}
