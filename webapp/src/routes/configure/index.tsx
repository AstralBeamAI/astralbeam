import { createFileRoute, useRouter } from "@tanstack/react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/config"
import { ConfigEditor } from "./-components/config-editor"
import { ConfigureActions } from "./-components/configure-actions"
import { OperatorLoginForm } from "./-components/operator-login-form"
import { OperatorSessionStatus } from "./-components/operator-session-status"
import { PendingMigrationsCard } from "./-components/pending-migrations-card"
import { getConfigureState } from "./-functions/get-configure-state"

export const Route = createFileRoute("/configure/")({
  loader: () => getConfigureState(),
  component: ConfigurePage,
  pendingComponent: ConfigurePageSkeleton,
  head: () => ({ meta: [{ title: `Configure · ${APP_NAME}` }] }),
})

function ConfigurePage() {
  const state = Route.useLoaderData()
  const router = useRouter()
  const refresh = () => void router.invalidate()

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Configure {APP_NAME}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your {APP_NAME} deployment needs to be configured before others can use it.
          </p>
        </div>
        {state.authenticated && (
          <OperatorSessionStatus
            dbUsername={state.dbUsername}
            sessionExpiresAt={state.sessionExpiresAt}
          />
        )}
      </header>

      {!state.authenticated
        ? <OperatorLoginForm onLoggedIn={refresh} />
        : state.migrations.pending.length > 0
        ? (
          <>
            <ConfigureActions setupComplete={state.setupComplete} />
            <PendingMigrationsCard
              pending={state.migrations.pending}
              appliedCount={state.migrations.appliedCount}
              onApplied={refresh}
            />
            <ConfigureActions setupComplete={state.setupComplete} />
          </>
        )
        : (
          <ConfigEditor
            fields={state.fields}
            issues={state.issues}
            setupComplete={state.setupComplete}
            onChanged={refresh}
          />
        )}
    </main>
  )
}

function ConfigurePageSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </main>
  )
}
