import { eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"
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

import { effectDatabaseLayer, getAuthDatabase, runDatabaseEffect } from "@/db"
import { revokeOrganizationAccess } from "@/db/organization-deletion.server"
import {
  agent,
  member,
  organization,
  organizationConfiguration,
  sandboxProvider,
  tenant,
  tenantUser,
  user,
} from "@/db/schema.server"
import deleteOrganization, { deleteOrganizationWorkflowLayer } from "./delete-organization.ts"

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
    return organizationId
  }

  test("revokes access at once and purges only the deleted organization", async () => {
    const deletedId = await createOrganization("deleted")
    const keptId = await createOrganization("kept")

    await runDatabaseEffect(revokeOrganizationAccess(deletedId))
    expect(await db.select().from(member).where(eq(member.organizationId, deletedId))).toEqual([])

    await runDatabaseEffect(
      deleteOrganization
        .execute({ organizationId: deletedId, operationId: crypto.randomUUID() })
        .pipe(
          Effect.provide(
            deleteOrganizationWorkflowLayer.pipe(
              Layer.provideMerge(WorkflowEngine.layerMemory),
              Layer.provide(effectDatabaseLayer),
            ),
          ),
        ),
    )

    const remaining = await db.select({ id: organization.id }).from(organization)
    expect(remaining).toEqual([{ id: keptId }])
    const tenantUsers = await db
      .select({ organizationId: tenantUser.organizationId })
      .from(tenantUser)
    expect(new Set(tenantUsers.map((row) => row.organizationId))).toEqual(new Set([keptId]))
    expect(tenantUsers).toHaveLength(2001)
  })
})
