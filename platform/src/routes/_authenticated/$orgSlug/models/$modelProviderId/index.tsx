import { ArrowLeftIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"
import { cn } from "cn"
import { Schema } from "effect"

import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { UuidV7Schema } from "@/lib/schemas"
import { ModelProviderActions } from "./-components/model-provider-actions"
import { ModelProviderForm } from "../-components/model-provider-form"
import { getModelProviderPageData } from "../-functions/get-model-provider-page-data"

const isModelProviderId = Schema.is(UuidV7Schema)

export const Route = createFileRoute("/_authenticated/$orgSlug/models/$modelProviderId/")({
  preload: false,
  gcTime: 0,
  beforeLoad: ({ context, params }) => {
    if (!isModelProviderId(params.modelProviderId)) throw notFound()
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ params }) => {
      const page = await getModelProviderPageData({
        data: { organizationSlug: params.orgSlug, id: params.modelProviderId },
      })
      if (!page.data.provider) throw notFound()
      return { ...page, data: { ...page.data, provider: page.data.provider } }
    },
  },
  component: ModelProviderPage,
  pendingComponent: ModelProviderPageSkeleton,
  head: () => ({ meta: [{ title: `Model provider · ${APP_NAME}` }] }),
})

function ModelProviderPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <Link
          to="/$orgSlug/models"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Models
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{data.provider.name}</h1>
        <p className="text-sm text-muted-foreground">
          Enable models here, then assign them to an agent.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {permissions.updateConfiguration && data.provider.models.length > 0 && (
          <Link
            to="/$orgSlug/agents"
            params={{ orgSlug }}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Set up an agent
          </Link>
        )}
        {permissions.deleteConfiguration && (
          <ModelProviderActions organizationSlug={orgSlug} provider={data.provider} />
        )}
      </div>
      <ModelProviderForm
        key={`${data.provider.id}:${data.provider.lockVersion}`}
        organizationSlug={orgSlug}
        provider={data.provider}
        catalog={data.catalog}
        pricingFetchedAt={data.pricingFetchedAt}
        pricingIsStale={data.pricingIsStale}
        readOnly={!permissions.updateConfiguration}
      />
    </div>
  )
}

function ModelProviderPageSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-96 w-full max-w-2xl rounded-xl" />
    </div>
  )
}
