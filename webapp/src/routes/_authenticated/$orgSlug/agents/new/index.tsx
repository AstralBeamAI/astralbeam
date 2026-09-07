import { ArrowLeftIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { AgentForm } from "../-components/agent-form"
import { getNewAgentPageData } from "./-functions/get-new-agent-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/agents/new/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.updateConfiguration) {
      throw redirect({
        to: "/$orgSlug/agents",
        params: { orgSlug: params.orgSlug },
        replace: true,
      })
    }
  },
  loader: ({ params }) => getNewAgentPageData({ data: { organizationSlug: params.orgSlug } }),
  component: NewAgentPage,
  pendingComponent: NewAgentPageSkeleton,
  head: () => ({ meta: [{ title: `New agent · ${APP_NAME}` }] }),
})

function NewAgentPage() {
  const { orgSlug } = Route.useParams()
  const { data } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <Link
          to="/$orgSlug/agents"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Agents
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add agent</h1>
        <p className="text-sm text-muted-foreground">
          Name the agent, pick its permanent identifier, and write its system prompt.
        </p>
      </div>
      <AgentForm
        organizationSlug={orgSlug}
        agent={null}
        sandboxProviders={data.sandboxProviders}
        readOnly={false}
      />
    </div>
  )
}

function NewAgentPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-48" />
      </div>
      <Skeleton className="h-[32rem] w-full max-w-2xl rounded-xl" />
    </div>
  )
}
