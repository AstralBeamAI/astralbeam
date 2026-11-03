import { sql } from "drizzle-orm"

import { formatAgentId } from "@/lib/agents/schemas.ts"

import { agent, organizationConfiguration } from "@/db/schema.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_ORGANIZATIONS } from "./fixtures.ts"

export type SeedAgentSummary = {
  readonly id: string
  readonly name: string
  readonly isDefault: boolean
}

/**
 * Creates each organization's agents and default-agent configuration.
 *
 * This mirrors what `Agents.provisionDefault` in `src/lib/agents/agents.server.ts` does for a
 * real organization, by hand: that function is written as an Effect program against the
 * server-only database service and cannot be reached from a plain script.
 */
export async function seedAgents(transaction: SeedTransaction): Promise<SeedAgentSummary[]> {
  const summaries: SeedAgentSummary[] = []
  for (const seedOrganization of SEED_ORGANIZATIONS) {
    const organizationId = seedOrganization.id

    const seededAgentIds = new Set<string>()
    for (const seedAgent of seedOrganization.agents) {
      const [inserted] = await transaction
        .insert(agent)
        .values({
          id: seedAgent.id,
          organizationId,
          name: seedAgent.name,
          systemPrompt: seedAgent.systemPrompt,
          attachmentsEnabled: seedAgent.attachmentsEnabled,
          webAccessEnabled: false,
        })
        .onConflictDoUpdate({
          target: [agent.organizationId, agent.id],
          set: {
            name: seedAgent.name,
            systemPrompt: seedAgent.systemPrompt,
            attachmentsEnabled: seedAgent.attachmentsEnabled,
            webAccessEnabled: false,
          },
        })
        .returning({ id: agent.id })
      if (!inserted) {
        throw new Error(`PostgreSQL did not return a row for agent '${seedAgent.name}'`)
      }
      seededAgentIds.add(inserted.id)
      summaries.push({
        id: formatAgentId({ organizationId, id: inserted.id }),
        name: seedAgent.name,
        isDefault: seedAgent.id === seedOrganization.defaultAgentId,
      })
    }

    const { defaultAgentId } = seedOrganization
    if (!seededAgentIds.has(defaultAgentId)) {
      throw new Error(
        `Default agent '${defaultAgentId}' is missing from organization '${seedOrganization.id}'`,
      )
    }
    await transaction
      .insert(organizationConfiguration)
      .values({ organizationId, defaultAgentId })
      .onConflictDoUpdate({
        target: organizationConfiguration.organizationId,
        set: {
          defaultAgentId,
          lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
          updatedAt: sql`now()`,
        },
      })
  }
  return summaries
}
