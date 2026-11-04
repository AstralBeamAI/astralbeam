import { eq, sql } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { getAuthDatabase } from "@/db/database"
import { organization, sandboxProvider } from "@/db/schema/organizations"
import { SandboxProviders } from "./providers.server.ts"

const configured = process.env.DATABASE_URL
const databaseUrl =
  configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
if (
  databaseUrl &&
  (new URL(databaseUrl).hostname !== "127.0.0.1" ||
    !new URL(databaseUrl).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")

describe.skipIf(!databaseUrl)("operator-owned sandbox images", () => {
  const runtime = ManagedRuntime.make(SandboxProviders.layer)
  let db: ReturnType<typeof getAuthDatabase>
  let organizationId: string
  beforeAll(async () => {
    db = getAuthDatabase()
    const [row] = await db
      .insert(organization)
      .values({ name: "Image policy", slug: `image-${crypto.randomUUID()}`, domain: "example.com" })
      .returning({ id: organization.id })
    organizationId = row!.id
  })
  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, organizationId))
    await runtime.dispose()
  })

  test.each(["docker", "microsandbox"] as const)(
    "ignores legacy %s image selections without rewriting the row",
    async (providerType) => {
      const [row] = await db
        .insert(sandboxProvider)
        .values({ organizationId, name: providerType, providerType, options: {} })
        .returning({ id: sandboxProvider.id })
      await db.execute(
        sql`update sandbox_provider set options = '{"image":"customer/untrusted:latest"}'::jsonb where organization_id = ${organizationId} and id = ${row!.id}`,
      )
      const input = { organizationId, id: row!.id }
      const restored = await runtime.runPromise(
        Effect.flatMap(SandboxProviders, (providers) => providers.get(input)),
      )
      const resolved = await runtime.runPromise(
        Effect.flatMap(SandboxProviders, (providers) => providers.resolveConfiguration(input)),
      )
      expect(restored?.options).toEqual({})
      expect(resolved.options).toEqual({})
      const [stored] = await db
        .select({ options: sql<unknown>`${sandboxProvider.options}` })
        .from(sandboxProvider)
        .where(eq(sandboxProvider.id, row!.id))
      expect(stored?.options).toEqual({ image: "customer/untrusted:latest" })
    },
  )
})
