"use client"

import { CopyIcon, RobotIcon, StarIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { OrganizationAgent } from "@/db/agent.server"
import { copyAgentId } from "../-lib/utils"

export type AgentListCardProps = {
  organizationSlug: string
  agent: OrganizationAgent
  isDefault: boolean
}

export function AgentListCard({ organizationSlug, agent, isDefault }: AgentListCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RobotIcon aria-hidden="true" />
          <Link
            to="/$orgSlug/agents/$agentId"
            params={{ orgSlug: organizationSlug, agentId: agent.id }}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            {agent.name}
          </Link>
          {isDefault && (
            <Badge variant="secondary" className="gap-1">
              <StarIcon aria-hidden="true" />
              Default
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Agent ID</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{agent.id}</code>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={`Copy ${agent.name} agent ID`}
              title={`Copy ${agent.name} agent ID`}
              onClick={() => void copyAgentId(agent.id)}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {agent.systemPrompt}
        </p>
      </CardContent>
    </Card>
  )
}
