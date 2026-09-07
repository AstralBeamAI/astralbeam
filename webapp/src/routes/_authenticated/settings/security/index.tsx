import { createFileRoute } from "@tanstack/react-router"

import { Settings } from "@/components/auth/settings/settings"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"

export const Route = createFileRoute(
  "/_authenticated/settings/security/",
)({
  component: SecuritySettingsRoute,
  pendingComponent: SecuritySettingsSkeleton,
  head: () => ({ meta: [{ title: `Security settings · ${APP_NAME}` }] }),
})

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

function SecuritySettingsSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8"
      aria-busy="true"
    >
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-10 w-72 rounded-lg" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
