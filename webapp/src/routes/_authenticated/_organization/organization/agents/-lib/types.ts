import type { OrganizationAgent } from "@/db/organization-agent.server"
import type { SandboxProviderId } from "@/lib/sandbox/schemas"

export type { OrganizationAgent }

export interface AgentSandboxProviderSummary {
  readonly id: string
  readonly name: string
  readonly providerType: SandboxProviderId
}

export interface OrganizationAgentState {
  readonly organizationId: string
  readonly organizationSlug: string
  readonly agents: readonly OrganizationAgent[]
  readonly sandboxProviders: readonly AgentSandboxProviderSummary[]
}
