import { PlusIcon, RobotIcon } from "@phosphor-icons/react"
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
import { AgentListCard } from "./-components/agent-list-card"
import { getAgentsPageData } from "./-functions/get-agents-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/agents/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: ({ params }) => getAgentsPageData({ data: { organizationSlug: params.orgSlug } }),
  component: AgentsPage,
  pendingComponent: AgentsPageSkeleton,
  head: () => ({ meta: [{ title: `Agents · ${APP_NAME}` }] }),
})

function AgentsPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Set the default instructions for each chat experience.
          </p>
          <p className="text-sm text-muted-foreground">
            Copy an agent's browser-safe ID into the SDK's{" "}
            <code className="font-mono text-foreground">agentId</code>{" "}
            option, or omit that option to use the default agent.
          </p>
        </div>
        {permissions.updateConfiguration && (
          <Link
            to="/$orgSlug/agents/new"
            params={{ orgSlug }}
            className={buttonVariants()}
          >
            <PlusIcon aria-hidden="true" />
            Add agent
          </Link>
        )}
      </div>

      {data.agents.length === 0
        ? (
          <Empty className="max-w-4xl">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RobotIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No agents yet</EmptyTitle>
              <EmptyDescription>
                Every embedded chat runs an agent. Add one to give it a name and a system prompt.
              </EmptyDescription>
            </EmptyHeader>
            {permissions.updateConfiguration && (
              <EmptyContent>
                <Link
                  to="/$orgSlug/agents/new"
                  params={{ orgSlug }}
                  className={buttonVariants({ size: "sm" })}
                >
                  Add agent
                </Link>
              </EmptyContent>
            )}
          </Empty>
        )
        : (
          <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
            {data.agents.map((agent) => (
              <AgentListCard
                key={agent.id}
                organizationSlug={orgSlug}
                agent={agent}
                isDefault={agent.id === data.defaultAgentId}
              />
            ))}
          </div>
        )}
    </div>
  )
}

function AgentsPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    </div>
  )
}
