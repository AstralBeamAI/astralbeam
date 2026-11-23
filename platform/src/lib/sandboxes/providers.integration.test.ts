import { eq, sql } from "drizzle-orm"
import { SandboxConnection } from "@astralbeam/sandbox"
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

describe.skipIf(!databaseUrl)("sandbox provider persistence", () => {
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

  test("repairs and deletes providers with unreadable credentials", async () => {
    const providers = await runtime.runPromise(SandboxProviders)
    const checked = vi.spyOn(SandboxConnection.prototype, "valid").mockResolvedValue(true)
    try {
      const fields = { organizationId, providerType: "e2b", options: { template: "base" } } as const
      const name = "Credential repair"
      await expect(
        runtime.runPromise(
          providers.save({
            ...fields,
            name,
            id: null,
            lockVersion: null,
            options: {},
            credentials: { apiKey: "test" },
          }),
        ),
      ).rejects.toThrow("Invalid sandbox provider configuration")
      expect(checked).not.toHaveBeenCalled()
      const id = await runtime.runPromise(
        providers.save({
          ...fields,
          id: null,
          lockVersion: null,
          name,
          credentials: { apiKey: "initial-test-key" },
        }),
      )
      const corruptCredentials = () =>
        db.execute(
          sql`update sandbox_provider set credentials = 'corrupt', updated_at = now() where organization_id = ${organizationId} and id = ${id}`,
        )
      await corruptCredentials()
      expect(await runtime.runPromise(providers.get({ organizationId, id }))).toMatchObject({
        credentialsReadable: false,
        credentials: {},
      })
      await runtime.runPromise(
        providers.save({
          ...fields,
          id,
          lockVersion: 0,
          name,
          credentials: { apiKey: "replacement-test-key" },
        }),
      )
      expect(
        await runtime.runPromise(providers.resolveConfiguration({ organizationId, id })),
      ).toMatchObject({ credentials: { apiKey: "replacement-test-key" } })
      await corruptCredentials()
      await runtime.runPromise(providers.remove({ organizationId, id, lockVersion: 1 }))
      expect(await runtime.runPromise(providers.get({ organizationId, id }))).toBeNull()
    } finally {
      checked.mockRestore()
    }
  })
})
