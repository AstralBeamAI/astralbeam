import { and, eq, sql } from "drizzle-orm"

import {
  chatMessage,
  chatMessagePart,
  chatParticipant,
  chatThread,
  configTable,
  organizationConfiguration,
  tenant,
  tenantUser,
} from "../../src/db/schema.server.ts"

import type { SeedTransaction } from "./database.ts"
import {
  SEED_CONVERSATIONS,
  SEED_ORGANIZATIONS,
  SEED_TODOS_TARGET,
  SEED_USERS,
} from "./fixtures.ts"

type Conversation = (typeof SEED_CONVERSATIONS)[keyof typeof SEED_CONVERSATIONS][number]

type ChatIdentity = {
  organizationId: string
  agentId: string | null
  tenant: { externalId: string; name: string; metadata: Record<string, string> }
  user: { externalId: string; name: string; admin: boolean; metadata: Record<string, string> }
}

export type SeedConversationsSummary = { todos: number; astro: number | "no dogfood" }

/**
 * Seeds saved conversations for the todos tenant user and for the `acme` owner as Astro sees them.
 * Astro's identity mirrors `issueDashboardToken`: the viewed Organization is the dogfood Tenant.
 */
export async function seedConversations(
  transaction: SeedTransaction,
  userIdsByEmail: ReadonlyMap<string, string>,
): Promise<SeedConversationsSummary> {
  const [acme] = SEED_ORGANIZATIONS
  const { id: todosUserId, ...todosUser } = SEED_TODOS_TARGET.user
  const todos = await seedThreads(
    transaction,
    {
      organizationId: acme.id,
      agentId: acme.defaultAgentId,
      tenant: { externalId: SEED_TODOS_TARGET.tenant.id, name: acme.tenants[0].name, metadata: {} },
      user: { ...todosUser, externalId: todosUserId },
    },
    SEED_CONVERSATIONS.todos,
  )

  const [dogfood] = await transaction
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, "dogfood_organization_id"))
  if (!dogfood?.value) return { todos, astro: "no dogfood" }
  const [configuration] = await transaction
    .select({ agentId: organizationConfiguration.defaultAgentId })
    .from(organizationConfiguration)
    .where(eq(organizationConfiguration.organizationId, dogfood.value.value))
  const owner = SEED_USERS.find((seedUser) => seedUser.email === acme.members[0].email)!
  const astro = await seedThreads(
    transaction,
    {
      organizationId: dogfood.value.value,
      agentId: configuration?.agentId ?? null,
      tenant: { externalId: acme.id, name: acme.name, metadata: { slug: acme.slug } },
      user: {
        externalId: userIdsByEmail.get(owner.email)!,
        name: owner.name,
        admin: false,
        metadata: { email: owner.email },
      },
    },
    SEED_CONVERSATIONS.astro,
  )
  return { todos, astro }
}

/** Skips a conversation whose fixed thread ID already exists, so reseeding keeps edits. */
async function seedThreads(
  transaction: SeedTransaction,
  identity: ChatIdentity,
  conversations: readonly Conversation[],
): Promise<number> {
  const { organizationId } = identity
  const [customer] = await transaction
    .insert(tenant)
    .values({ organizationId, ...identity.tenant })
    .onConflictDoUpdate({
      target: [tenant.organizationId, tenant.externalId],
      set: { name: identity.tenant.name, metadata: identity.tenant.metadata },
    })
    .returning({ id: tenant.id })
  const [author] = await transaction
    .insert(tenantUser)
    .values({ organizationId, tenantId: customer!.id, ...identity.user })
    .onConflictDoUpdate({
      target: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.externalId],
      set: { name: identity.user.name, metadata: identity.user.metadata },
    })
    .returning({ id: tenantUser.id })
  const scope = { organizationId, tenantId: customer!.id }

  let created = 0
  for (const conversation of conversations) {
    const activity = sql`now() - make_interval(hours => ${conversation.hoursAgo})`
    const [thread] = await transaction
      .insert(chatThread)
      .values({
        ...scope,
        id: conversation.id,
        agentId: identity.agentId,
        title: conversation.title,
      })
      .onConflictDoNothing()
      .returning({ id: chatThread.id })
    if (!thread) continue
    const threadScope = { ...scope, threadId: thread.id }
    await transaction
      .insert(chatParticipant)
      .values({ ...threadScope, tenantUserId: author!.id, role: "manager" })

    let leafId: string | null = null
    for (const [question, answer] of conversation.turns) {
      const [input]: { id: string }[] = await transaction
        .insert(chatMessage)
        .values({
          ...threadScope,
          parentMessageId: leafId,
          authorTenantUserId: author!.id,
          role: "user",
          state: "complete",
          turnState: "completed",
          metadata: { version: 1 },
        })
        .returning({ id: chatMessage.id })
      const [reply]: { id: string }[] = await transaction
        .insert(chatMessage)
        .values({
          ...threadScope,
          parentMessageId: input!.id,
          turnMessageId: input!.id,
          role: "assistant",
          state: "complete",
          metadata: { version: 1 },
        })
        .returning({ id: chatMessage.id })
      await transaction.insert(chatMessagePart).values([
        { ...threadScope, messageId: input!.id, position: 0, payload: textPart(question) },
        { ...threadScope, messageId: reply!.id, position: 0, payload: textPart(answer) },
      ])
      leafId = reply!.id
    }
    await transaction
      .update(chatThread)
      .set({ currentLeafMessageId: leafId, createdAt: activity, updatedAt: activity })
      .where(and(eq(chatThread.organizationId, organizationId), eq(chatThread.id, thread.id)))
    created += 1
  }
  return created
}

function textPart(content: string) {
  return { version: 1 as const, type: "text" as const, content }
}
