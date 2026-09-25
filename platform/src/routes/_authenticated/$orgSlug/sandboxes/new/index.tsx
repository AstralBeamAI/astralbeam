import { ArrowLeftIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"
import { SandboxProviderForm } from "../-components/sandbox-provider-form"

export const Route = createFileRoute("/_authenticated/$orgSlug/sandboxes/new/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.updateConfiguration) {
      throw redirect({
        to: "/$orgSlug/sandboxes",
        params: { orgSlug: params.orgSlug },
        replace: true,
      })
    }
  },
  component: NewSandboxProviderPage,
  head: () => ({ meta: [{ title: `New sandbox provider · ${APP_NAME}` }] }),
})

function NewSandboxProviderPage() {
  const { orgSlug } = Route.useParams()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <Link
          to="/$orgSlug/sandboxes"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Sandboxes
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add sandbox provider</h1>
        <p className="text-sm text-muted-foreground">
          Saving runs a real connection test first, so a provider is never stored untested.
        </p>
      </div>
      <SandboxProviderForm organizationSlug={orgSlug} provider={null} readOnly={false} />
    </div>
  )
}
