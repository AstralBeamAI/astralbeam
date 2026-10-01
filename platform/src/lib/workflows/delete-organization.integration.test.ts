import { eq, sql } from "drizzle-orm"
import { Effect, Fiber, Layer } from "effect"
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
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { Mailer } from "@/lib/email/email.server"
import { revokeOrganizationAccess } from "@/lib/organizations/deletion.server"
import {
  agent,
  agentModel,
  modelProvider,
  providerModel,
  member,
  organization,
  organizationConfiguration,
  sandboxProvider,
  tenant,
  tenantUser,
  user,
} from "@/db/schema.server"
import deleteOrganization, {
  deleteOrganizationWorkflowLayer,
} from "./delete-organization.server.ts"

describe.skipIf(!deleteOrganizationIntegration.url)("organization deletion workflow", () => {
  let db: ReturnType<typeof getAuthDatabase>
  beforeEach(async () => {
    db = getAuthDatabase()
    await db.execute(sql`truncate "organization", "user" cascade`)
  })

  async function createOrganization(slug: string) {
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
    await db
      .insert(agentModel)
      .values({
        organizationId,
        agentId: defaultAgent!.id,
        providerModelId: model!.id,
        position: 0,
      })
    await db.insert(organizationConfiguration).values({
      organizationId,
      defaultAgentId: defaultAgent!.id,
    })
    const [owned] = await db.insert(tenant).values({ organizationId, externalId: "t" }).returning()
    await db.insert(tenantUser).values(
      Array.from({ length: 2001 }, (_, index) => ({
        organizationId,
        tenantId: owned!.id,
        externalId: `u${index}`,
      })),
    )
    return { organizationId, ownerId: owner!.id }
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

  test("revokes access at once and purges only the deleted organization", async () => {
    const { organizationId: deletedId, ownerId } = await createOrganization("deleted")
    const { organizationId: keptId } = await createOrganization("kept")

    expect(await runAppEffect(revokeOrganizationAccess(deletedId))).toEqual([ownerId])
    expect(await db.select().from(member).where(eq(member.organizationId, deletedId))).toEqual([])

    await runAppEffect(organizationDeletion(deletedId))

    const remaining = await db.select({ id: organization.id }).from(organization)
    expect(remaining).toEqual([{ id: keptId }])
    const tenantUsers = await db
      .select({ organizationId: tenantUser.organizationId })
      .from(tenantUser)
    expect(new Set(tenantUsers.map((row) => row.organizationId))).toEqual(new Set([keptId]))
    expect(tenantUsers).toHaveLength(2001)
    for (const table of [modelProvider, providerModel, agentModel]) {
      expect(await db.select({ organizationId: table.organizationId }).from(table)).toEqual([
        { organizationId: keptId },
      ])
    }
  })

  test("keeps retrying a failed purge past any backoff window until the database recovers", async () => {
    const { organizationId } = await createOrganization("deleted")
    await db.execute(sql`alter table tenant_user rename to tenant_user_offline`)
    let offline = true
    // Later suites share this database, so restore the table even when the test fails.
    const restoreTenantUsers = async () => {
      if (!offline) return
      offline = false
      await db.execute(sql`alter table tenant_user_offline rename to tenant_user`)
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
          yield* Effect.promise(restoreTenantUsers)
          yield* realPause
          yield* TestClock.adjust("5 minutes")
          yield* Fiber.join(deletion)
        }).pipe(Effect.provide(TestClock.layer())),
      )
    } finally {
      await restoreTenantUsers()
    }
    expect(await db.select().from(organization)).toEqual([])
  })
})
