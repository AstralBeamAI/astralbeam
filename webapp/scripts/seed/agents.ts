import { sql } from "drizzle-orm"

import { agent, organizationConfiguration, sandboxProvider } from "../../src/db/schema.server.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_ORGANIZATIONS } from "./fixtures.ts"

export type SeedAgentSummary = {
  readonly publicId: string
  readonly name: string
  readonly isDefault: boolean
  readonly sandboxProviderName: string | null
}

/**
 * Creates each organization's sandbox providers, agents, and default-agent configuration.
 *
 * This mirrors what `provisionOrganizationDefaultAgent` in `src/db/agent.server.ts` does for a
 * real organization, by hand: that function is written as an Effect program against the
 * server-only database service and cannot be reached from a plain script.
 */
export async function seedAgents(
  transaction: SeedTransaction,
  organizationIdsBySlug: ReadonlyMap<string, string>,
): Promise<SeedAgentSummary[]> {
  const summaries: SeedAgentSummary[] = []
  for (const seedOrganization of SEED_ORGANIZATIONS) {
    const organizationId = organizationIdsBySlug.get(seedOrganization.slug)
    if (!organizationId) {
      throw new Error(`Organization '${seedOrganization.slug}' was not seeded`)
    }

    const providerIdsByName = new Map<string, string>()
    for (const provider of seedOrganization.sandboxProviders) {
      const [inserted] = await transaction
        .insert(sandboxProvider)
        .values({
          organizationId,
          name: provider.name,
          providerType: provider.providerType,
          options: provider.options,
          // Docker is the only provider with no credential to encrypt, and `lastTest` is display
          // only: the chat endpoint hands an agent sandbox tools without consulting it.
          credentials: null,
          lastTest: null,
        })
        .onConflictDoUpdate({
          target: [sandboxProvider.organizationId, sandboxProvider.name],
          set: {
            providerType: provider.providerType,
            options: provider.options,
            credentials: null,
          },
        })
        .returning({ id: sandboxProvider.id })
      if (!inserted) {
        throw new Error(`PostgreSQL did not return a row for provider '${provider.name}'`)
      }
      providerIdsByName.set(provider.name, inserted.id)
    }

    const agentIdsBySlug = new Map<string, string>()
    for (const seedAgent of seedOrganization.agents) {
      const sandboxProviderId = seedAgent.sandboxProviderName === null
        ? null
        : providerIdsByName.get(seedAgent.sandboxProviderName) ?? null
      if (seedAgent.sandboxProviderName !== null && sandboxProviderId === null) {
        throw new Error(
          `Agent '${seedAgent.slug}' references unseeded provider '${seedAgent.sandboxProviderName}'`,
        )
      }
      const [inserted] = await transaction
        .insert(agent)
        .values({
          organizationId,
          slug: seedAgent.slug,
          name: seedAgent.name,
          systemPrompt: seedAgent.systemPrompt,
          attachmentsEnabled: seedAgent.attachmentsEnabled,
          sandboxProviderId,
        })
        .onConflictDoUpdate({
          target: [agent.organizationId, agent.slug],
          set: {
            name: seedAgent.name,
            systemPrompt: seedAgent.systemPrompt,
            attachmentsEnabled: seedAgent.attachmentsEnabled,
            sandboxProviderId,
          },
        })
        .returning({ id: agent.id })
      if (!inserted) {
        throw new Error(`PostgreSQL did not return a row for agent '${seedAgent.slug}'`)
      }
      agentIdsBySlug.set(seedAgent.slug, inserted.id)
      summaries.push({
        publicId: `agt_${seedOrganization.slug}_${seedAgent.slug}`,
        name: seedAgent.name,
        isDefault: seedAgent.slug === seedOrganization.defaultAgentSlug,
        sandboxProviderName: seedAgent.sandboxProviderName,
      })
    }

    const defaultAgentId = agentIdsBySlug.get(seedOrganization.defaultAgentSlug)
    if (!defaultAgentId) {
      throw new Error(
        `Default agent '${seedOrganization.defaultAgentSlug}' is missing from organization '${seedOrganization.slug}'`,
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
