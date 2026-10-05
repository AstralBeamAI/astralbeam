import { and, eq, getTableName, sql } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"
import { WorkflowEngine } from "effect/workflow"
import { beforeEach, describe, expect, test, vi } from "vitest"

const deleteOrganizationIntegration = vi.hoisted(() => {
  const configured = globalThis.process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test")) {
      throw new Error("Use a disposable loopback database ending in _test")
    }
  }
  return { url }
})

import { Database, getAuthDatabase } from "@/db/database.server"
import { getForeignKeyDeferrability } from "@/db/lib/columns.server"
import { sqlState } from "@/db/lib/sqlstate.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { Mailer } from "@/lib/email/email.server"
import {
  deleteOrganization as deleteOrganizationFn,
  deleteOrganizationTenantBatch,
  revokeOrganizationAccess,
} from "@/lib/organizations/deletion.server"
import { deleteTenant } from "@/lib/tenants/deletion.server"
import {
  agent,
  agentModel,
  cacheEntry,
  chatMessage,
  chatMessagePart,
  chatParticipant,
  chatThread,
  chatToolResponse,
  modelProvider,
  providerModel,
  member,
  organization,
  organizationConfiguration,
  sandboxProvider,
  tenant,
  tenantUser,
  tables,
  user,
} from "@/db/schema.server"
import deleteOrganization, {
  deleteOrganizationWorkflowLayer,
} from "./delete-organization.server.ts"

describe.skipIf(!deleteOrganizationIntegration.url)("organization deletion workflow", () => {
  let db: ReturnType<typeof getAuthDatabase>
  beforeEach(async () => {
    db = getAuthDatabase()
    await db.execute(sql`truncate "organization", "user", "cache_entry" cascade`)
  })

  async function createOrganization(slug: string, tenantId?: string) {
    const [owner] = await db
      .insert(user)
      .values({ name: slug, email: `${slug}@example.com` })
      .returning()
    const [created] = await db.insert(organization).values({ name: slug, slug }).returning()
    const organizationId = created!.id
    await db.insert(member).values({ organizationId, userId: owner!.id, role: "owner" })
    const [provider] = await db
      .insert(sandboxProvider)
      .values({ organizationId, name: "Local", providerType: "docker", options: { image: "node" } })
      .returning()
    const [defaultAgent] = await db
      .insert(agent)
      .values({ organizationId, name: slug, systemPrompt: "Help", sandboxProviderId: provider!.id })
      .returning()
    const [models] = await db
      .insert(modelProvider)
      .values({
        organizationId,
        name: "Models",
        providerType: "openai",
        api: "responses",
        baseUrl: "https://api.openai.com/v1",
      })
      .returning()
    const [model] = await db
      .insert(providerModel)
      .values({ organizationId, modelProviderId: models!.id, modelId: "test", name: "Test" })
      .returning()
    await db.insert(agentModel).values({
      organizationId,
      agentId: defaultAgent!.id,
      providerModelId: model!.id,
      position: 0,
    })
    await db.insert(organizationConfiguration).values({
      organizationId,
      defaultAgentId: defaultAgent!.id,
    })
    const [owned] = await db
      .insert(tenant)
      .values({ organizationId, id: tenantId, externalId: "t" })
      .returning()
    await db.insert(tenantUser).values({ organizationId, tenantId: owned!.id, externalId: "u" })
    return {
      organizationId,
      ownerId: owner!.id,
      tenantId: owned!.id,
      agentId: defaultAgent!.id,
    }
  }

  async function createDeletionChat(scope: {
    organizationId: string
    tenantId: string
    agentId: string
  }) {
    const [author] = await db
      .select({ id: tenantUser.id })
      .from(tenantUser)
      .where(
        and(
          eq(tenantUser.organizationId, scope.organizationId),
          eq(tenantUser.tenantId, scope.tenantId),
        ),
      )
      .limit(1)
    const [thread] = await db.insert(chatThread).values(scope).returning()
    const chatScope = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      threadId: thread!.id,
    }
    const messageScope = {
      ...chatScope,
      state: "complete" as const,
      metadata: { version: 1 as const },
    }
    await db.insert(chatParticipant).values({
      ...chatScope,
      tenantUserId: author!.id,
      role: "manager",
    })
    const [input] = await db
      .insert(chatMessage)
      .values({
        ...messageScope,
        authorTenantUserId: author!.id,
        role: "user",
        turnState: "completed",
      })
      .returning()
    const [assistant] = await db
      .insert(chatMessage)
      .values({
        ...messageScope,
        role: "assistant",
        parentMessageId: input!.id,
        turnMessageId: input!.id,
      })
      .returning()
    const [decision] = await db
      .insert(chatMessagePart)
      .values({
        ...chatScope,
        messageId: assistant!.id,
        position: 0,
        executionLocation: "browser",
        payload: {
          version: 1,
          type: "tool-call",
          name: "confirm",
          arguments: "{}",
          toolCallId: "call",
        },
      })
      .returning()
    const [result] = await db
      .insert(chatMessage)
      .values({
        ...messageScope,
        role: "tool",
        authorTenantUserId: author!.id,
        parentMessageId: assistant!.id,
        turnMessageId: input!.id,
      })
      .returning()
    await db.insert(chatMessagePart).values({
      ...chatScope,
      messageId: result!.id,
      position: 0,
      payload: { version: 1, type: "tool-result", outcome: "succeeded", output: true },
    })
    await db.insert(chatToolResponse).values({
      ...chatScope,
      toolPartId: decision!.id,
      tenantUserId: author!.id,
      resultMessageId: result!.id,
    })
    await db
      .update(chatThread)
      .set({ currentLeafMessageId: result!.id })
      .where(eq(chatThread.id, thread!.id))
    return {
      threadId: thread!.id,
      inputMessageId: input!.id,
      toolPartId: decision!.id,
      resultMessageId: result!.id,
      authorId: author!.id,
    }
  }

  function organizationDeletion(organizationId: string) {
    return deleteOrganization
      .execute({
        organizationId,
        operationId: crypto.randomUUID(),
        organizationName: "deleted",
        ownerUserIds: [],
      })
      .pipe(
        Effect.provide(
          deleteOrganizationWorkflowLayer.pipe(
            Layer.provideMerge(WorkflowEngine.layerMemory),
            // No owners are passed, so the notice step never reaches the Mailer.
            Layer.provide([Database.layerNoDeps, Layer.succeed(Mailer, {} as Mailer["Service"])]),
          ),
        ),
      )
  }

  test("keeps all foreign keys deferrable and bound to complete primary keys", async () => {
    const expectedReferences = new Map(
      Object.values(tables).flatMap((table) => {
        const config = getTableConfig(table)
        return config.foreignKeys.map((constraint) => {
          const reference = constraint.reference()
          return [
            JSON.stringify([config.name, reference.columns.map((column) => column.name)]),
            {
              table: getTableName(reference.foreignTable),
              columns: reference.foreignColumns.map((column) => column.name),
              deferrable: getForeignKeyDeferrability(constraint),
              onDelete: constraint.onDelete,
              onUpdate: constraint.onUpdate,
            },
          ] as const
        })
      }),
    )
    const { rows } = await db.execute<{
      tableName: string
      localColumns: string[]
      foreignTable: string
      foreignColumns: string[]
      deferrable: boolean
      initiallyDeferred: boolean
      validated: boolean
      enforced: boolean
      deleteAction: string
      updateAction: string
      referencesPrimaryKey: boolean
      usesPrimaryKeyIndex: boolean
    }>(sql`select table_row.relname as "tableName",
      array(select column_row.attname::text
        from unnest(constraint_row.conkey) with ordinality as key_column(attnum, position)
        join pg_attribute column_row on column_row.attrelid = constraint_row.conrelid
          and column_row.attnum = key_column.attnum
        order by key_column.position) as "localColumns",
      referenced_table.relname as "foreignTable",
      array(select column_row.attname::text
        from unnest(constraint_row.confkey) with ordinality as key_column(attnum, position)
        join pg_attribute column_row on column_row.attrelid = constraint_row.confrelid
          and column_row.attnum = key_column.attnum
        order by key_column.position) as "foreignColumns",
      constraint_row.condeferrable as deferrable,
      constraint_row.condeferred as "initiallyDeferred",
      constraint_row.convalidated as validated,
      constraint_row.conenforced as enforced,
      constraint_row.confdeltype as "deleteAction",
      constraint_row.confupdtype as "updateAction",
      constraint_row.confkey = referenced_key.conkey as "referencesPrimaryKey",
      constraint_row.conindid = referenced_key.conindid as "usesPrimaryKeyIndex"
    from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_class referenced_table on referenced_table.oid = constraint_row.confrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    left join pg_constraint referenced_key on referenced_key.conrelid = constraint_row.confrelid
      and referenced_key.contype = 'p'
    where constraint_row.contype = 'f' and namespace_row.nspname = 'public'
      and table_row.relname !~ '^effect_'`)
    expect(rows).toHaveLength(expectedReferences.size)
    expect(
      rows.filter(
        (row) =>
          !row.deferrable ||
          !row.validated ||
          !row.enforced ||
          row.deleteAction === "r" ||
          row.updateAction === "r" ||
          !row.referencesPrimaryKey ||
          !row.usesPrimaryKeyIndex,
      ),
    ).toEqual([])
    const actions: Record<string, string> = {
      a: "no action",
      c: "cascade",
      n: "set null",
      d: "set default",
    }
    for (const row of rows) {
      const reference = expectedReferences.get(JSON.stringify([row.tableName, row.localColumns]))
      expect(reference).toEqual({
        table: row.foreignTable,
        columns: row.foreignColumns,
        deferrable: row.initiallyDeferred ? "deferred" : "immediate",
        onDelete: actions[row.deleteAction],
        onUpdate: actions[row.updateAction],
      })
    }
  })

  test("rolls back unresolved deferred deletion, then commits parent-first deletion", async () => {
    const deleted = await createOrganization("deleted")
    const deletedId = deleted.organizationId
    await expect(
      db.delete(sandboxProvider).where(eq(sandboxProvider.organizationId, deletedId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } })
    await expect(
      db.transaction(async (transaction) => {
        await transaction.execute(sql`set constraints all deferred`)
        await transaction
          .delete(sandboxProvider)
          .where(eq(sandboxProvider.organizationId, deletedId))
      }),
    ).rejects.toMatchObject({ query: "commit", cause: { code: "23503" } })
    expect(
      await db
        .select({ organizationId: sandboxProvider.organizationId })
        .from(sandboxProvider)
        .where(eq(sandboxProvider.organizationId, deletedId)),
    ).toEqual([{ organizationId: deletedId }])

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`set constraints all deferred`)
      for (const table of [sandboxProvider, providerModel, agent]) {
        await transaction.delete(table).where(eq(table.organizationId, deletedId))
      }
      await transaction.delete(organization).where(eq(organization.id, deletedId))
    })

    expect(await db.select().from(organization)).toEqual([])
  })

  test("agent deletion clears optional selections and preserves their scope and chat history", async () => {
    const scope = await createOrganization("history")
    const chat = await createDeletionChat(scope)
    await db.delete(agent).where(eq(agent.id, scope.agentId))

    expect(
      await db
        .select({
          organizationId: organizationConfiguration.organizationId,
          defaultAgentId: organizationConfiguration.defaultAgentId,
        })
        .from(organizationConfiguration),
    ).toEqual([{ organizationId: scope.organizationId, defaultAgentId: null }])
    expect(
      await db
        .select({
          organizationId: chatThread.organizationId,
          tenantId: chatThread.tenantId,
          agentId: chatThread.agentId,
          leaf: chatThread.currentLeafMessageId,
        })
        .from(chatThread),
    ).toEqual([
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        agentId: null,
        leaf: chat.resultMessageId,
      },
    ])
    expect(await db.select({ id: chatMessage.id }).from(chatMessage)).toHaveLength(3)
    expect(
      await db.select({ id: chatToolResponse.resultMessageId }).from(chatToolResponse),
    ).toEqual([{ id: chat.resultMessageId }])
  })

  test("rejects chat references to another thread within the same Tenant", async () => {
    const scope = await createOrganization("thread-scope")
    const first = await createDeletionChat(scope)
    const second = await createDeletionChat(scope)

    for (const update of [
      db
        .update(chatThread)
        .set({ currentLeafMessageId: second.resultMessageId })
        .where(eq(chatThread.id, first.threadId)),
      db
        .update(chatMessage)
        .set({ parentMessageId: second.resultMessageId })
        .where(eq(chatMessage.id, first.resultMessageId)),
      db
        .update(chatMessage)
        .set({ turnMessageId: second.inputMessageId })
        .where(eq(chatMessage.id, first.resultMessageId)),
      db
        .update(chatMessagePart)
        .set({ messageId: second.resultMessageId, position: 1 })
        .where(eq(chatMessagePart.id, first.toolPartId)),
      db
        .update(chatToolResponse)
        .set({ toolPartId: second.toolPartId })
        .where(eq(chatToolResponse.threadId, first.threadId)),
      db
        .update(chatToolResponse)
        .set({ resultMessageId: second.resultMessageId })
        .where(eq(chatToolResponse.threadId, first.threadId)),
    ]) {
      await expect(update).rejects.toMatchObject({ cause: { code: "23503" } })
    }
  })

  test("keeps positions and accepted results scoped to each thread when UUIDs are reused", async () => {
    const scope = await createOrganization("tenant-uuid")
    const first = await createDeletionChat(scope)
    const second = await createDeletionChat(scope)
    const chatScope = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      threadId: second.threadId,
    }

    await db.insert(chatMessage).values({
      ...chatScope,
      id: first.resultMessageId,
      role: "tool",
      state: "complete",
      turnMessageId: second.inputMessageId,
      metadata: { version: 1 },
    })
    const resultPart = {
      ...chatScope,
      messageId: first.resultMessageId,
      position: 0,
      payload: { version: 1, type: "tool-result", outcome: "succeeded", output: true } as const,
    }
    await db.insert(chatMessagePart).values({ ...resultPart, id: first.toolPartId })
    const acceptedResult = {
      ...chatScope,
      toolPartId: second.toolPartId,
      tenantUserId: second.authorId,
      resultMessageId: first.resultMessageId,
    }
    await db.insert(chatToolResponse).values(acceptedResult)

    await expect(db.insert(chatMessagePart).values(resultPart)).rejects.toMatchObject({
      cause: { code: "23505", constraint: "chat_message_part_position_uidx" },
    })
    await expect(db.insert(chatToolResponse).values(acceptedResult)).rejects.toMatchObject({
      cause: { code: "23505", constraint: "chat_tool_response_result_uidx" },
    })
  })

  test("direct Tenant deletion commits all chat cascades and preserves other Tenants", async () => {
    const deleted = await createOrganization("deleted")
    const kept = await createOrganization("kept")
    const [sibling] = await db
      .insert(tenant)
      .values({ organizationId: deleted.organizationId, externalId: "sibling" })
      .returning()
    await db.insert(tenantUser).values({
      organizationId: deleted.organizationId,
      tenantId: sibling!.id,
      externalId: "sibling-user",
    })
    const deletedChat = await createDeletionChat(deleted)
    await createDeletionChat(kept)
    const siblingChat = await createDeletionChat({ ...deleted, tenantId: sibling!.id })

    await expect(
      db
        .update(chatMessage)
        .set({ authorTenantUserId: siblingChat.authorId })
        .where(eq(chatMessage.id, deletedChat.resultMessageId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } })
    await expect(
      db
        .update(chatToolResponse)
        .set({ tenantUserId: siblingChat.authorId })
        .where(eq(chatToolResponse.threadId, deletedChat.threadId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } })
    await expect(
      db.delete(tenantUser).where(eq(tenantUser.id, deletedChat.authorId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } })

    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`delete from tenant where organization_id = ${deleted.organizationId} and id = ${deleted.tenantId}`,
      )
    })

    for (const table of [
      tenantUser,
      chatThread,
      chatParticipant,
      chatMessage,
      chatMessagePart,
      chatToolResponse,
    ]) {
      const rows = await db.select({ tenantId: table.tenantId }).from(table)
      expect(new Set(rows.map((row) => row.tenantId))).toEqual(
        new Set([kept.tenantId, sibling!.id]),
      )
    }
    expect(await db.select({ id: organization.id }).from(organization)).toHaveLength(2)
    expect(await db.select({ id: agent.id }).from(agent)).toHaveLength(2)
  })

  test("direct Organization deletion commits populated chat cascades and preserves another Organization", async () => {
    const deleted = await createOrganization("deleted")
    const kept = await createOrganization("kept")
    await createDeletionChat(deleted)
    await createDeletionChat(kept)

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`delete from organization where id = ${deleted.organizationId}`)
    })

    expect(await db.select({ id: organization.id }).from(organization)).toEqual([
      { id: kept.organizationId },
    ])
    for (const table of [
      tenant,
      tenantUser,
      chatThread,
      chatParticipant,
      chatMessage,
      chatMessagePart,
      chatToolResponse,
      agent,
      agentModel,
      sandboxProvider,
      modelProvider,
      providerModel,
      organizationConfiguration,
    ]) {
      const rows = await db.select({ organizationId: table.organizationId }).from(table)
      expect(new Set(rows.map((row) => row.organizationId))).toEqual(new Set([kept.organizationId]))
    }
  })

  test.each([
    ["Tenant", (scope: { organizationId: string; tenantId: string }) => deleteTenant(scope)],
    [
      "Organization",
      (scope: { organizationId: string }) => deleteOrganizationFn(scope.organizationId),
    ],
  ] as const)(
    "defers constraints for the %s purge even in an immediate transaction",
    async (_, purge) => {
      const scope = await createOrganization("deleted")
      const kept = await createOrganization("kept", scope.tenantId)
      await createDeletionChat(scope)
      await createDeletionChat(kept)
      await runAppEffect(
        Effect.gen(function* () {
          const sqlClient = yield* SqlClient.SqlClient
          yield* sqlClient.withTransaction(
            Effect.gen(function* () {
              yield* sqlClient`SET CONSTRAINTS ALL IMMEDIATE`
              yield* purge(scope)
            }),
          )
        }),
      )
      expect(await db.select({ organizationId: tenant.organizationId }).from(tenant)).toEqual([
        { organizationId: kept.organizationId },
      ])
      const messages = await db
        .select({ organizationId: chatMessage.organizationId })
        .from(chatMessage)
      expect(new Set(messages.map((row) => row.organizationId))).toEqual(
        new Set([kept.organizationId]),
      )
    },
  )

  test("commits earlier Tenant deletions when a later Tenant fails, then resumes the purge", async () => {
    const scope = await createOrganization("partial")
    await createDeletionChat(scope)
    const [blocked] = await db
      .insert(tenant)
      .values({ organizationId: scope.organizationId, externalId: "blocked" })
      .returning()
    await db.execute(sql`create table tenant_purge_blocker (
      organization_id uuid not null,
      tenant_id uuid not null,
      primary key (organization_id, tenant_id),
      foreign key (organization_id, tenant_id) references tenant (organization_id, id)
        deferrable initially immediate
    )`)
    try {
      await db.execute(sql`insert into tenant_purge_blocker (organization_id, tenant_id)
        values (${scope.organizationId}, ${blocked!.id})`)
      const failure = await runAppEffect(
        deleteOrganizationTenantBatch(scope.organizationId).pipe(Effect.exit),
      )
      expect(
        Exit.match(failure, {
          onFailure: (cause) => sqlState(Cause.squash(cause)),
          onSuccess: () => undefined,
        }),
      ).toBe("23503")
      expect(await db.select({ id: tenant.id }).from(tenant)).toEqual([{ id: blocked!.id }])
      expect(await db.select().from(chatMessage)).toEqual([])
      expect(await db.select({ id: organization.id }).from(organization)).toEqual([
        { id: scope.organizationId },
      ])
      await runAppEffect(
        Effect.gen(function* () {
          const deletion = yield* Effect.forkChild(organizationDeletion(scope.organizationId))
          for (let step = 0; step < 4; step++) {
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)))
            yield* TestClock.adjust("5 minutes")
          }
          yield* Effect.promise(() => db.execute(sql`drop table tenant_purge_blocker`))
          yield* TestClock.adjust("5 minutes")
          yield* Fiber.join(deletion)
        }).pipe(Effect.provide(TestClock.layer())),
      )
    } finally {
      await db.execute(sql`drop table if exists tenant_purge_blocker`)
    }
    expect(await db.select().from(organization)).toEqual([])
  })

  test("revokes access at once and purges only the deleted organization", async () => {
    const deleted = await createOrganization("deleted")
    const kept = await createOrganization("kept")
    const { organizationId: deletedId, ownerId } = deleted
    const { organizationId: keptId } = kept
    const deletedChat = await createDeletionChat(deleted)
    const [anotherTenant] = await db
      .insert(tenant)
      .values({ organizationId: deletedId, externalId: "another" })
      .returning()
    await db.insert(tenantUser).values({
      organizationId: deletedId,
      tenantId: anotherTenant!.id,
      externalId: "another",
    })
    await createDeletionChat({ ...deleted, tenantId: anotherTenant!.id })
    const keptChat = await createDeletionChat(kept)
    await db.insert(cacheEntry).values([
      { namespace: `chat:${deletedChat.threadId}`, key: "accepted", value: "saved input" },
      { namespace: `chat:${keptChat.threadId}`, key: "accepted", value: "kept input" },
    ])

    expect(await runAppEffect(revokeOrganizationAccess(deletedId))).toEqual([ownerId])
    expect(await db.select().from(member).where(eq(member.organizationId, deletedId))).toEqual([])

    const connection = await db.$client.connect()
    await connection.query("begin")
    await connection.query("select id from chat_thread where organization_id = $1 for update", [
      deletedId,
    ])
    const deletion = runAppEffect(organizationDeletion(deletedId))
    try {
      await vi.waitFor(async () => {
        const waiting = await db.execute(sql`select 1 from pg_stat_activity
          where wait_event_type = 'Lock' and query like '%chat_thread%' and query like '%for update%'`)
        expect(waiting.rows).not.toHaveLength(0)
      })
    } finally {
      await connection.query("rollback")
      connection.release()
      await deletion
    }

    expect(await db.select({ namespace: cacheEntry.namespace }).from(cacheEntry)).toEqual([
      { namespace: `chat:${keptChat.threadId}` },
    ])
    const remaining = await db.select({ id: organization.id }).from(organization)
    expect(remaining).toEqual([{ id: keptId }])
    const tenantUsers = await db
      .select({ organizationId: tenantUser.organizationId })
      .from(tenantUser)
    expect(tenantUsers).toEqual([{ organizationId: keptId }])
    expect(await db.select({ organizationId: chatThread.organizationId }).from(chatThread)).toEqual(
      [{ organizationId: keptId }],
    )
    for (const table of [modelProvider, providerModel, agentModel]) {
      expect(await db.select({ organizationId: table.organizationId }).from(table)).toEqual([
        { organizationId: keptId },
      ])
    }
  })

  test("keeps retrying a failed purge past any backoff window until the database recovers", async () => {
    const { organizationId } = await createOrganization("deleted")
    await db.execute(sql`alter table tenant rename to tenant_offline`)
    let offline = true
    // Later suites share this database, so restore the table even when the test fails.
    const restoreDeletionTenants = async () => {
      if (!offline) return
      offline = false
      await db.execute(sql`alter table tenant_offline rename to tenant`)
    }
    const realPause = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50)))
    try {
      await runAppEffect(
        Effect.gen(function* () {
          const deletion = yield* Effect.forkChild(organizationDeletion(organizationId))
          // Two virtual hours of backoff while the table is offline.
          for (let step = 0; step < 24; step++) {
            yield* realPause
            yield* TestClock.adjust("5 minutes")
          }
          yield* Effect.promise(restoreDeletionTenants)
          yield* realPause
          yield* TestClock.adjust("5 minutes")
          yield* Fiber.join(deletion)
        }).pipe(Effect.provide(TestClock.layer())),
      )
    } finally {
      await restoreDeletionTenants()
    }
    expect(await db.select().from(organization)).toEqual([])
  })
})
