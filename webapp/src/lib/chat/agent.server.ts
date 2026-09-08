import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { agent, organizationConfiguration } from "@/db/schema.server"
import { toStoredAgentId } from "@/lib/schemas"

/**
 * Resolve malformed and cross-organization public IDs identically. A host that sends no public ID
 * gets the organization's configured default agent. The returned `id` is the stored UUIDv7.
 */
export async function resolveChatAgent(
  publicId: unknown,
  authenticatedOrganizationId: string,
) {
  const useDefault = publicId === undefined || publicId === null
  const storedId = useDefault ? null : toStoredAgentId(publicId)
  if (storedId === null && !useDefault) return null
  const rows = await runDatabaseEffect(
    Effect.flatMap(effectDatabase, (db) => {
      const query = db.select({
        id: agent.id,
        systemPrompt: agent.systemPrompt,
        attachmentsEnabled: agent.attachmentsEnabled,
        sandboxProviderId: agent.sandboxProviderId,
      }).from(agent)
      const scoped = storedId === null
        ? query.innerJoin(
          organizationConfiguration,
          and(
            eq(agent.id, organizationConfiguration.defaultAgentId),
            eq(agent.organizationId, organizationConfiguration.organizationId),
          ),
        ).where(eq(agent.organizationId, authenticatedOrganizationId))
        : query.where(
          and(
            eq(agent.id, storedId),
            eq(agent.organizationId, authenticatedOrganizationId),
          ),
        )
      return scoped.limit(1)
    }),
  )
  return rows[0] ?? null
}
