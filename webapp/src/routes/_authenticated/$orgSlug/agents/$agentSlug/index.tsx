import { ArrowLeftIcon, CopyIcon, StarIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { AgentForm } from "../-components/agent-form"
import { agentPublicId, copyAgentPublicId } from "../-lib/utils"
import { AgentActions } from "./-components/agent-actions"
import { getAgentPageData } from "./-functions/get-agent-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/agents/$agentSlug/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: async ({ params }) => {
    const page = await getAgentPageData({
      data: { organizationSlug: params.orgSlug, agentSlug: params.agentSlug },
    })
    if (!page) throw notFound()
    return page
  },
  component: AgentPage,
  pendingComponent: AgentPageSkeleton,
  head: () => ({ meta: [{ title: `Agent · ${APP_NAME}` }] }),
})

function AgentPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()
  const publicId = agentPublicId(orgSlug, data.agent.slug)

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
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {data.agent.name}
          </h1>
          {data.isDefault && (
            <Badge variant="secondary" className="gap-1">
              <StarIcon aria-hidden="true" />
              Default
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="text-xs text-muted-foreground">{publicId}</code>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Copy agent ID"
            title="Copy agent ID"
            onClick={() => void copyAgentPublicId(publicId)}
          >
            <CopyIcon aria-hidden="true" />
          </Button>
        </div>
      </div>

      <AgentActions
        organizationSlug={orgSlug}
        agent={data.agent}
        isDefault={data.isDefault}
        canSetDefault={permissions.updateConfiguration}
        canDelete={permissions.deleteConfiguration}
      />

      <AgentForm
        organizationSlug={orgSlug}
        agent={data.agent}
        sandboxProviders={data.sandboxProviders}
        readOnly={!permissions.updateConfiguration}
      />
    </div>
  )
}

function AgentPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-[32rem] w-full max-w-2xl rounded-xl" />
    </div>
  )
}
