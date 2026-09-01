import { and, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { agent, organization } from "@/db/schema.server"

const AGENT_ID_PATTERN = /^agt_([0-9a-z]{1,63})_([0-9a-z]{1,63})$/

/** Resolve malformed, missing, and cross-organization public IDs identically. */
export async function resolveChatAgent(
  publicId: unknown,
  authenticatedOrganizationId: string,
) {
  if (typeof publicId !== "string") return null
  const parsed = AGENT_ID_PATTERN.exec(publicId)
  const organizationSlug = parsed?.[1]
  const agentSlug = parsed?.[2]
  if (!organizationSlug || !agentSlug) return null
  const rows = await runDatabaseEffect(
    Effect.flatMap(effectDatabase, (db) =>
      db.select({
        systemPrompt: agent.systemPrompt,
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
