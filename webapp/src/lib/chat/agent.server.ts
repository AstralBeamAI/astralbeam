import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { agent, organizationConfiguration } from "@/db/schema.server"
import { AgentIdSchema } from "@/lib/schemas"

const isAgentId = Schema.is(AgentIdSchema)

/**
 * Resolve malformed and cross-organization public IDs identically. A host that sends no public ID
 * gets the organization's configured default agent.
 */
export async function resolveChatAgent(
  publicId: unknown,
  authenticatedOrganizationId: string,
) {
  const useDefault = publicId === undefined || publicId === null
  if (!useDefault && !isAgentId(publicId)) return null
  const rows = await runDatabaseEffect(
    Effect.flatMap(effectDatabase, (db) => {
      const query = db.select({
        id: agent.id,
        systemPrompt: agent.systemPrompt,
        attachmentsEnabled: agent.attachmentsEnabled,
        sandboxProviderId: agent.sandboxProviderId,
      }).from(agent)
      const scoped = useDefault
        ? query.innerJoin(
          organizationConfiguration,
          and(
            eq(agent.id, organizationConfiguration.defaultAgentId),
            eq(agent.organizationId, organizationConfiguration.organizationId),
          ),
        ).where(eq(agent.organizationId, authenticatedOrganizationId))
        : query.where(
          and(
            eq(agent.id, publicId),
            eq(agent.organizationId, authenticatedOrganizationId),
          ),
        )
      return scoped.limit(1)
    }),
  )
  return rows[0] ?? null
}
