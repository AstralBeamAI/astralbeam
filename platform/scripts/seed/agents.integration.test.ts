import process from "node:process"

import { eq, sql } from "drizzle-orm"
import { afterEach, expect, test, vi } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { agent, organization, sandboxProvider } from "@/db/schema"
import { seedAgents } from "./agents.ts"
import { SEED_ORGANIZATIONS } from "./fixtures.ts"

const configured = process.env.DATABASE_URL
const databaseUrl =
  configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
if (
  databaseUrl &&
  (new URL(databaseUrl).hostname !== "127.0.0.1" ||
    !new URL(databaseUrl).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")

afterEach(() => vi.unstubAllEnvs())

test.skipIf(!databaseUrl)("sandbox reseeding preserves edits and assignments", async () => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "seed-sandbox-integration-key-not-for-production")
  const rollback = new Error("Rollback seed fixtures")
  await expect(
    getAuthDatabase().transaction(async (transaction) => {
      await transaction.execute(sql`truncate "organization" cascade`)
      for (const { id, name, slug } of SEED_ORGANIZATIONS)
        await transaction.insert(organization).values({ id, name, slug, domain: "example.com" })
      await seedAgents(transaction)
      const provider = (await transaction.select().from(sandboxProvider))[0]!
      expect(provider.providerType).toBe("docker")

      await transaction
        .update(sandboxProvider)
        .set({
          providerType: "e2b",
          options: { template: "operator-template" },
          credentials: {
            organizationId: provider.organizationId,
            sandboxProviderId: provider.id,
            providerType: "e2b",
            credentials: { apiKey: "operator-test-key" },
          },
        })
        .where(eq(sandboxProvider.id, provider.id))
      const columns = {
        id: sandboxProvider.id,
        providerType: sandboxProvider.providerType,
        options: sandboxProvider.options,
        credentials: sql<string>`${sandboxProvider.credentials}::text`,
      }
      const before = await transaction.select(columns).from(sandboxProvider)
      const [starter, todos] = SEED_ORGANIZATIONS[0].agents
      await transaction
        .update(agent)
        .set({ sandboxProviderId: provider.id })
        .where(eq(agent.id, starter.id))
      await transaction.update(agent).set({ sandboxProviderId: null }).where(eq(agent.id, todos.id))
      await seedAgents(transaction)
      expect(
        await transaction
          .select({ id: agent.id, sandboxProviderId: agent.sandboxProviderId })
          .from(agent),
      ).toEqual(
        expect.arrayContaining([
          { id: starter.id, sandboxProviderId: provider.id },
          { id: todos.id, sandboxProviderId: null },
        ]),
      )
      expect(await transaction.select(columns).from(sandboxProvider)).toEqual(before)
      throw rollback
    }),
  ).rejects.toBe(rollback)
})
