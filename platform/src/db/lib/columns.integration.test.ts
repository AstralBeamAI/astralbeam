import { eq, sql } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

const jsonbIntegration = vi.hoisted(() => {
  const url = globalThis.process.env.DATABASE_URL
  if (!url || url === "postgres://test:test@127.0.0.1:5432/test") return { url: undefined }
  const parsed = new URL(url)
  if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
    throw new Error("Use a disposable loopback database ending in _test")
  return { url }
})

import { Database, getAuthDatabase } from "../database.server.ts"
import { organization, sandboxProvider, tenant } from "../schema.server.ts"

describe.skipIf(!jsonbIntegration.url)("schema-backed JSONB columns", () => {
  const runtime = ManagedRuntime.make(Database.layer)
  let db: ReturnType<typeof getAuthDatabase>
  let organizationId: string
  beforeAll(async () => {
    db = getAuthDatabase()
    const [row] = await db
      .insert(organization)
      .values({ name: "JSONB", slug: "jsonb-test" })
      .returning()
    organizationId = row!.id
  })
  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, organizationId))
    await runtime.dispose()
  })

  test("round trips JSON through writes and ordinary and relational reads", async () => {
    const [row] = await db
      .insert(tenant)
      .values({ organizationId, externalId: "valid" })
      .returning()
    expect(row!.metadata).toEqual({})
    const metadata = { nested: { list: [1, true, null] }, label: "retained" }
    await runtime.runPromise(
      Effect.flatMap(Database, (database) =>
        database.update(tenant).set({ metadata }).where(eq(tenant.id, row!.id)),
      ),
    )
    expect((await db.select().from(tenant).where(eq(tenant.id, row!.id)))[0]!.metadata).toEqual(
      metadata,
    )
    const restored = await runtime.runPromise(
      Effect.flatMap(Database, (database) =>
        database.query.organization.findFirst({
          where: { id: organizationId },
          with: { tenants: true },
        }),
      ),
    )
    expect(restored!.tenants[0]!.metadata).toEqual(metadata)
  })

  test("rejects invalid writes and corrupted reads without silently stripping fields", async () => {
    await expect(
      db.insert(tenant).values({
        organizationId,
        externalId: "invalid",
        metadata: [] as unknown as typeof tenant.$inferInsert.metadata,
      }),
    ).rejects.toThrow()
    expect(await db.select().from(tenant).where(eq(tenant.externalId, "invalid"))).toEqual([])
    await expect(
      db.insert(sandboxProvider).values({
        organizationId,
        name: "Invalid",
        providerType: "docker",
        options: {
          image: "test-image",
          unexpected: true,
        } as unknown as typeof sandboxProvider.$inferInsert.options,
      }),
    ).rejects.toThrow()
    const [row] = await db
      .insert(sandboxProvider)
      .values({
        organizationId,
        name: "Corrupted",
        providerType: "docker",
        options: { image: "test-image" },
      })
      .returning()
    for (const invalid of ['{"image":"test-image"}', { image: "test-image", unexpected: true }]) {
      await db.execute(
        sql`update sandbox_provider set options = ${JSON.stringify(invalid)}::jsonb where id = ${row!.id}`,
      )
      await expect(
        db.select().from(sandboxProvider).where(eq(sandboxProvider.id, row!.id)),
      ).rejects.toThrow()
      await expect(db.query.sandboxProvider.findFirst({ where: { id: row!.id } })).rejects.toThrow()
    }
  })
})
