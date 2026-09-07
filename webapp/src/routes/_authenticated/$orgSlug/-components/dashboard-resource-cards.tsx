import { CubeIcon, type Icon, KeyIcon, RobotIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { OrganizationResourceCounts } from "@/db/organization.server"

export type DashboardResourceCardsProps = {
  organizationSlug: string
  /** A null count means the loader withheld the resource, which is also why no card appears. */
  counts: OrganizationResourceCounts
}

const CARD_CLASS_NAME = "transition-colors hover:border-primary/40"

function ResourceCardBody(
  { count, description, icon: ResourceIcon, label }: {
    count: number
    description: string
    icon: Icon
    label: string
  },
): ReactNode {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <ResourceIcon aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>
      </CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  )
}

export function DashboardResourceCards({
  organizationSlug,
  counts,
}: DashboardResourceCardsProps) {
  const params = { orgSlug: organizationSlug }

  return (
    <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
      {counts.agents !== null && (
        <Link to="/$orgSlug/agents" params={params}>
          <Card className={CARD_CLASS_NAME}>
            <ResourceCardBody
              count={counts.agents}
              description="Named instructions each embedded chat runs with."
              icon={RobotIcon}
              label="Agents"
            />
          </Card>
        </Link>
      )}
      {counts.sandboxProviders !== null && (
        <Link to="/$orgSlug/sandboxes" params={params}>
          <Card className={CARD_CLASS_NAME}>
            <ResourceCardBody
              count={counts.sandboxProviders}
              description="Vendor backends that give an agent its sandbox tools."
              icon={CubeIcon}
              label="Sandboxes"
            />
          </Card>
        </Link>
      )}
      {counts.apiKeys !== null && (
        <Link to="/$orgSlug/api-keys" params={params}>
          <Card className={CARD_CLASS_NAME}>
            <ResourceCardBody
              count={counts.apiKeys}
              description="Server-side credentials that mint chat auth tokens."
              icon={KeyIcon}
              label="API keys"
            />
          </Card>
        </Link>
      )}
      <Link to="/$orgSlug/members" params={params}>
        <Card className={CARD_CLASS_NAME}>
          <ResourceCardBody
            count={counts.members}
            description="People who can sign in and configure this organization."
            icon={UsersThreeIcon}
            label="Members"
          />
        </Card>
      </Link>
    </div>
  )
}
