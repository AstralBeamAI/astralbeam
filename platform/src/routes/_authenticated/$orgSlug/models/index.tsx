import { CpuIcon, PlusIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { cn } from "cn"

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
import { ModelProviderListCard } from "./-components/model-provider-list-card"
import { getModelsPageData } from "./-functions/get-models-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/models/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration)
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
  },
  loader: ({ params }) => getModelsPageData({ data: { organizationSlug: params.orgSlug } }),
  component: ModelsPage,
  pendingComponent: ModelsPageSkeleton,
  head: () => ({ meta: [{ title: `Models · ${APP_NAME}` }] }),
})

function ModelsPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Models</h1>
          <p className="text-sm text-muted-foreground">
            Connect providers, enable models, then choose the models each agent can use.
          </p>
        </div>
        {permissions.updateConfiguration && (
          <Link to="/$orgSlug/models/new" params={{ orgSlug }} className={buttonVariants()}>
            <PlusIcon aria-hidden="true" />
            Add provider
          </Link>
        )}
      </div>
      {data.modelProviders.length === 0 ? (
        <Empty className="max-w-4xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CpuIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No model providers yet</EmptyTitle>
            <EmptyDescription>
              Add your first provider and enable at least one model to set up an agent. You can use
              multiple connections to the same provider.
            </EmptyDescription>
          </EmptyHeader>
          {permissions.updateConfiguration && (
            <EmptyContent>
              <Link
                to="/$orgSlug/models/new"
                params={{ orgSlug }}
                className={buttonVariants({ size: "sm" })}
              >
                Add your first provider
              </Link>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
            {data.modelProviders.map((provider) => (
              <ModelProviderListCard
                key={provider.id}
                organizationSlug={orgSlug}
                provider={provider}
              />
            ))}
          </div>
          <div>
            <Link
              to="/$orgSlug/agents"
              params={{ orgSlug }}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Set up an agent
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function ModelsPageSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <Skeleton className="h-9 w-40" />
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
