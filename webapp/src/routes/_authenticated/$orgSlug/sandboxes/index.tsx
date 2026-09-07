import { CubeIcon, PlusIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { SandboxProviderListCard } from "./-components/sandbox-provider-list-card"
import { getSandboxesPageData } from "./-functions/get-sandboxes-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/sandboxes/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: ({ params }) => getSandboxesPageData({ data: { organizationSlug: params.orgSlug } }),
  component: SandboxesPage,
  pendingComponent: SandboxesPageSkeleton,
  head: () => ({ meta: [{ title: `Sandboxes · ${APP_NAME}` }] }),
})

function SandboxesPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sandboxes</h1>
          <p className="text-sm text-muted-foreground">
            Configure named sandbox providers for this organization. Credentials are encrypted and
            visible only to organization owners and developers.
          </p>
        </div>
        {permissions.updateConfiguration && (
          <Link to="/$orgSlug/sandboxes/new" params={{ orgSlug }} className={buttonVariants()}>
            <PlusIcon aria-hidden="true" />
            Add provider
          </Link>
        )}
      </div>

      {data.sandboxProviders.length === 0
        ? (
          <Empty className="max-w-4xl">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CubeIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No sandbox providers yet</EmptyTitle>
              <EmptyDescription>
                Selecting a provider on an agent is what gives that agent its sandbox tools.
              </EmptyDescription>
            </EmptyHeader>
            {permissions.updateConfiguration && (
              <EmptyContent>
                <Link
                  to="/$orgSlug/sandboxes/new"
                  params={{ orgSlug }}
                  className={buttonVariants({ size: "sm" })}
                >
                  Add provider
                </Link>
              </EmptyContent>
            )}
          </Empty>
        )
        : (
          <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
            {data.sandboxProviders.map((provider) => (
              <SandboxProviderListCard
                key={provider.id}
                organizationSlug={orgSlug}
                provider={provider}
              />
            ))}
          </div>
        )}
    </div>
  )
}

function SandboxesPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
