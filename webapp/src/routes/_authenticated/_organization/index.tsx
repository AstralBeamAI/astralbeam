import { createFileRoute } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"

export const Route = createFileRoute("/_authenticated/_organization/")({
  component: DashboardRoute,
})

function DashboardRoute() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Your {APP_NAME} organization is ready.
        </p>
      </div>
    </div>
  )
}
