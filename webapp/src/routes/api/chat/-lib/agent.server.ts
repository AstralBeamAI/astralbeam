import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { agent, organization, organizationConfiguration } from "@/db/schema.server"
import { SlugSchema } from "@/lib/schemas"

const AgentIdSchema = Schema.TemplateLiteralParser(["agt_", SlugSchema, "_", SlugSchema])
const decodeAgentId = Schema.decodeUnknownOption(AgentIdSchema)

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
  const parsed = decodeAgentId(publicId)
  if (Option.isNone(parsed)) return null
  const [, organizationSlug, , agentSlug] = parsed.value
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
