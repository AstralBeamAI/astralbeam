import { inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { afterAll, describe, expect, test, vi } from "vitest"

const organizationCountsIntegration = vi.hoisted(() => {
  const configured = globalThis.process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
      throw new Error("Use a disposable loopback database ending in _test")
  }
  return { url }
})

import { getAuthDatabase } from "@/db/database"
import { apiKey, organization } from "@/db/schema/organizations"
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@/lib/api-keys/schemas"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { deriveOrganizationPermissions } from "./access.ts"
import { Organizations } from "./organizations.server.ts"

describe.skipIf(!organizationCountsIntegration.url)("organization dashboard counts", () => {
  const organizationIds: string[] = []
  afterAll(async () => {
    if (organizationIds.length > 0)
      await getAuthDatabase().delete(organization).where(inArray(organization.id, organizationIds))
  })

  test("separates usable keys from totals without leaking another organization's keys or restricted counts", async () => {
    const db = getAuthDatabase()
    const created = await db
      .insert(organization)
      .values([
        { name: "Dashboard", slug: `dashboard-${crypto.randomUUID()}` },
        { name: "Other", slug: `other-${crypto.randomUUID()}` },
      ])
      .returning({ id: organization.id })
    organizationIds.push(...created.map((row) => row.id))
    const organizationId = created[0]!.id
    const key = {
      organizationId,
      name: "Dashboard test key",
      configId: ORGANIZATION_API_KEY_CONFIG_ID,
    }
    await db.insert(apiKey).values([
      { ...key, key: crypto.randomUUID(), enabled: false },
      { ...key, key: crypto.randomUUID(), expiresAt: sql`now() - interval '1 second'` },
      { ...key, key: crypto.randomUUID(), expiresAt: sql`now()` },
      { ...key, key: crypto.randomUUID(), configId: "unrelated" },
      { ...key, key: crypto.randomUUID(), organizationId: created[1]!.id },
    ])
    const counts = (role: string) =>
      runAppEffect(
        Effect.flatMap(Organizations, (organizations) =>
          organizations.resourceCounts({
            organizationId,
            permissions: deriveOrganizationPermissions(role),
          }),
        ),
      )
    expect(await counts("owner")).toMatchObject({ apiKeys: 4, usableApiKeys: 0 })

    await db.insert(apiKey).values([
      { ...key, key: crypto.randomUUID() },
      { ...key, key: crypto.randomUUID(), expiresAt: sql`now() + interval '1 day'` },
    ])
    expect(await counts("developer")).toMatchObject({ apiKeys: 6, usableApiKeys: 2 })
    expect(await counts("viewer")).toEqual({
      agents: null,
      sandboxProviders: null,
      apiKeys: null,
      usableApiKeys: null,
      members: 0,
    })
  })
})
