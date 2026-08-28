import { WarningCircleIcon } from "@phosphor-icons/react"
import { createFileRoute, useRouter } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { ConfigEditor } from "./-components/config-editor"
import { ConfigureActions } from "./-components/configure-actions"
import { OperatorLoginForm } from "./-components/operator-login-form"
import { OperatorSessionStatus } from "./-components/operator-session-status"
import { PendingMigrationsCard } from "./-components/pending-migrations-card"
import { getConfigurePageState } from "./-functions/get-configure-page-state"

export const Route = createFileRoute("/configure/")({
  loader: () => getConfigurePageState(),
  component: ConfigurePage,
  pendingComponent: ConfigurePageSkeleton,
  head: () => ({ meta: [{ title: `Configure · ${APP_NAME}` }] }),
})

function ConfigurePage() {
  const state = Route.useLoaderData()
  const router = useRouter()

  if (state.status === "unavailable") {
    return <BootstrapErrorPage issues={state.bootstrapIssues} />
  }

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
        {state.status === "ready" && (
          <OperatorSessionStatus
            sessionExpiresAt={state.sessionExpiresAt}
          />
        )}
      </header>

      {state.status === "signed-out"
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
            fallbackEncryptionKeyCount={state.fallbackEncryptionKeyCount}
            onChanged={refresh}
          />
        )}
    </main>
  )
}

function BootstrapErrorPage({
  issues,
}: {
  issues: readonly ("DATABASE_URL" | "DATABASE_ENCRYPTION_KEY")[]
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Configure {APP_NAME}
        </h1>
        <p className="text-sm text-muted-foreground">
          Set the required server environment before configuring the application.
        </p>
      </header>
      <Alert variant="destructive">
        <WarningCircleIcon aria-hidden="true" />
        <AlertTitle>Server restart required</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            The following environment {issues.length === 1 ? "variable is" : "variables are"}{" "}
            missing or invalid:
          </p>
          <ul className="list-disc pl-4">
            {issues.map((issue) => (
              <li key={issue}>
                <code>{issue}</code>
              </li>
            ))}
          </ul>
          {issues.includes("DATABASE_URL") && (
            <p>
              Set <code>DATABASE_URL</code>{" "}
              to the PostgreSQL connection URL supplied by your database provider, such as{" "}
              <code>postgresql://user:password@host:5432/database</code>.
            </p>
          )}
          {issues.includes("DATABASE_ENCRYPTION_KEY") && (
            <p>
              Generate a high-entropy encryption key with{" "}
              <code>openssl rand -base64 32</code>, then set its output as{" "}
              <code>DATABASE_ENCRYPTION_KEY</code>.
            </p>
          )}
          <p>
            Use your deployment secret manager in production or{" "}
            <code>webapp/.env.development.local</code> locally, then restart the server.
          </p>
        </AlertDescription>
      </Alert>
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
