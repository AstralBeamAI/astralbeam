import { createFileRoute } from "@tanstack/react-router"

import { Settings } from "@/components/auth/settings/settings"

export const Route = createFileRoute(
  "/_authenticated/settings/security/",
)({ component: SecuritySettingsRoute })

function SecuritySettingsRoute() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Security settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your password, linked providers, and active sessions.
        </p>
      </div>
      <Settings view="security" />
    </div>
  )
}
