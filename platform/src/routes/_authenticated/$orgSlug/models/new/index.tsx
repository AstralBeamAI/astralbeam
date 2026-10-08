import { ArrowLeftIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"
import { ModelProviderForm } from "../-components/model-provider-form"
import { getModelProviderPageData } from "../-functions/get-model-provider-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/models/new/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.updateConfiguration) {
      throw redirect({ to: "/$orgSlug/models", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: ({ params }) =>
    getModelProviderPageData({ data: { organizationSlug: params.orgSlug, id: null } }),
  component: NewModelProviderPage,
  head: () => ({ meta: [{ title: `New model provider · ${APP_NAME}` }] }),
})

function NewModelProviderPage() {
  const { orgSlug } = Route.useParams()
  const { data } = Route.useLoaderData()
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
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add model provider</h1>
        <p className="text-sm text-muted-foreground">
          Connect a provider and enable the models your agents can use.
        </p>
      </div>
      <ModelProviderForm
        organizationSlug={orgSlug}
        provider={null}
        catalog={data.catalog}
        pricingFetchedAt={data.pricingFetchedAt}
        pricingIsStale={data.pricingIsStale}
        readOnly={false}
      />
    </div>
  )
}
