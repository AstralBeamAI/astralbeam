import { WarningCircleIcon } from "@phosphor-icons/react"
import { createFileRoute, useRouter } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { ConfigEditor } from "./-components/config-editor"
import { OperatorLoginForm } from "./-components/operator-login-form"
import { OperatorSessionStatus } from "./-components/operator-session-status"
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

  const refresh = () => void router.invalidate()

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Configure {APP_NAME}
          </h1>
          <p className="text-sm text-muted-foreground">
            Prepare your {APP_NAME} deployment before others can use it.
          </p>
        </div>
        {state.status === "ready" && (
          <OperatorSessionStatus
            sessionExpiresAt={state.sessionExpiresAt}
          />
        )}
      </header>

      {state.status === "unavailable"
        ? <BootstrapErrorAlert issues={state.bootstrapIssues} />
        : state.status === "migrations-required"
        ? <MigrationRequiredAlert />
        : state.status === "signed-out"
        ? <OperatorLoginForm onLoggedIn={refresh} />
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

function BootstrapErrorAlert({
  issues,
}: {
  issues: readonly ("DATABASE_URL" | "DATABASE_ENCRYPTION_KEY")[]
}) {
  return (
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
  )
}

function MigrationRequiredAlert() {
  return (
    <Alert variant="destructive">
      <WarningCircleIcon aria-hidden="true" />
      <AlertTitle>Database migrations required</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>The database schema must be up to date before {APP_NAME} can be configured.</p>
        <p>From the repository root, run:</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-foreground">
          <code>deno task --cwd webapp db migrate</code>
        </pre>
        <p>Reload this page after the command completes.</p>
      </AlertDescription>
    </Alert>
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
