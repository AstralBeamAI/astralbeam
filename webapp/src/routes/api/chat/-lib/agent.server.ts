import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { agent, organization, organizationConfiguration } from "@/db/schema.server"

const AGENT_ID_PATTERN = /^agt_([0-9a-z]{1,63})_([0-9a-z]{1,63})$/

/**
 * Resolve malformed and cross-organization public IDs identically. A host that sends no public ID
 * gets the organization's configured default agent.
 */
export async function resolveChatAgent(
  publicId: unknown,
  authenticatedOrganizationId: string,
) {
  if (publicId === undefined || publicId === null) {
    return await resolveDefaultChatAgent(authenticatedOrganizationId)
  }
  if (typeof publicId !== "string") return null
  const parsed = AGENT_ID_PATTERN.exec(publicId)
  const organizationSlug = parsed?.[1]
  const agentSlug = parsed?.[2]
  if (!organizationSlug || !agentSlug) return null
  const rows = await runDatabaseEffect(
    Effect.flatMap(effectDatabase, (db) =>
      db.select({
        id: agent.id,
        systemPrompt: agent.systemPrompt,
        attachmentsEnabled: agent.attachmentsEnabled,
        sandboxProviderId: agent.sandboxProviderId,
      }).from(organization).innerJoin(
        agent,
        and(eq(agent.organizationId, organization.id), eq(agent.slug, agentSlug)),
      ).where(
        and(
          eq(organization.slug, organizationSlug),
          eq(agent.organizationId, authenticatedOrganizationId),
        ),
      ).limit(1)),
  )
  return rows[0] ?? null
}

async function resolveDefaultChatAgent(authenticatedOrganizationId: string) {
  const rows = await runDatabaseEffect(
    Effect.flatMap(effectDatabase, (db) =>
      db.select({
        id: agent.id,
        systemPrompt: agent.systemPrompt,
        attachmentsEnabled: agent.attachmentsEnabled,
        sandboxProviderId: agent.sandboxProviderId,
      }).from(organizationConfiguration).innerJoin(
        agent,
        and(
          eq(agent.id, organizationConfiguration.defaultAgentId),
          eq(agent.organizationId, organizationConfiguration.organizationId),
        ),
      ).where(
        eq(organizationConfiguration.organizationId, authenticatedOrganizationId),
      ).limit(1)),
  )
  return rows[0] ?? null
}
