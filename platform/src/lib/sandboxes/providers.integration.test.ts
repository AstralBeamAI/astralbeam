import { eq, sql } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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
    vi.stubEnv("DOCKERSANDBOX_DISABLED", "true")
    vi.stubEnv("MICROSANDBOX_DISABLED", "true")
    vi.stubEnv("__ASTRALBEAM_INTERNAL_MICROSANDBOX_SDK", undefined)
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
    vi.unstubAllEnvs()
  })

  test.each(["docker", "microsandbox"] as const)(
    "ignores legacy %s image selections and normalizes explicit connection-test updates",
    async (providerType) => {
      const [row] = await db
        .insert(sandboxProvider)
        .values({ organizationId, name: providerType, providerType, options: {} })
        .returning({ id: sandboxProvider.id, lockVersion: sandboxProvider.lockVersion })
      await db.execute(
        sql`update sandbox_provider set options = '{"image":"customer/untrusted:latest"}'::jsonb where organization_id = ${organizationId} and id = ${row!.id}`,
      )
      const input = { organizationId, id: row!.id }
      const restored = await runtime.runPromise(
        Effect.flatMap(SandboxProviders, (providers) => providers.get(input)),
      )
      const disabled = await runtime.runPromise(
        Effect.flatMap(SandboxProviders, (providers) => providers.resolveConfiguration(input)).pipe(
          Effect.flip,
        ),
      )
      expect(disabled._tag).toBe("SandboxProviderUnavailable")
      const variable =
        providerType === "docker" ? "DOCKERSANDBOX_DISABLED" : "MICROSANDBOX_DISABLED"
      vi.stubEnv(variable, "false")
      const resolved = await runtime.runPromise(
        Effect.flatMap(SandboxProviders, (providers) => providers.resolveConfiguration(input)),
      )
      vi.stubEnv(variable, "true")
      expect(restored?.options).toEqual({})
      expect(resolved.options).toEqual({})
      const [stored] = await db
        .select({ options: sql<unknown>`${sandboxProvider.options}` })
        .from(sandboxProvider)
        .where(eq(sandboxProvider.id, row!.id))
      expect(stored?.options).toEqual({ image: "customer/untrusted:latest" })
      const result = await runtime.runPromise(
        Effect.flatMap(SandboxProviders, (providers) =>
          providers.testConnection({ ...input, lockVersion: row!.lockVersion }),
        ),
      )
      expect(result.status).toBe("failure")
      const [tested] = await db
        .select()
        .from(sandboxProvider)
        .where(eq(sandboxProvider.id, row!.id))
      expect(tested).toMatchObject({
        options: {},
        lastTest: result,
        lockVersion: row!.lockVersion + 1,
      })
    },
  )
})
