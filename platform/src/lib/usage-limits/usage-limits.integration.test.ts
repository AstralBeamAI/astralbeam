import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const usageLimitIntegration = vi.hoisted(() => {
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
import { organization, tenant, tenantUser, usageLimitCounter } from "@/db/schema"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import type { UsageSubject } from "./counters.ts"
import type { UsageLimitFields } from "./schemas.ts"
import { UsageLimits } from "./usage-limits.server.ts"

const weeklyTokens: UsageLimitFields = {
  name: "Weekly limit",
  enabled: true,
  appliesByDefault: true,
  scope: "tenant_user",
  metric: "tokens",
  amount: "1000",
  windowType: "rolling",
  windowCount: 1,
  windowUnit: "week",
  timeZone: null,
}

describe.skipIf(!usageLimitIntegration.url)("usage limit counters", () => {
  let db: ReturnType<typeof getAuthDatabase>
  beforeEach(async () => {
    db = getAuthDatabase()
    await db.execute(sql`truncate "organization" cascade`)
  })

  async function createSubjects() {
    const [org] = await db.insert(organization).values({ name: "Acme", slug: "acme" }).returning()
    const organizationId = org!.id
    const [owned] = await db
      .insert(tenant)
      .values({ organizationId, externalId: "t" })
      .returning({ id: tenant.id })
    const users = await db
      .insert(tenantUser)
      .values([
        { organizationId, tenantId: owned!.id, externalId: "ada" },
        { organizationId, tenantId: owned!.id, externalId: "grace" },
      ])
      .returning({ id: tenantUser.id })
    const subject = (index: number): UsageSubject => ({
      organizationId,
      tenantId: owned!.id,
      tenantUserId: users[index]!.id,
    })
    return { organizationId, ada: subject(0), grace: subject(1) }
  }

  function withLimits<A, E>(
    organizationId: string,
    fields: readonly UsageLimitFields[],
    use: (usageLimits: UsageLimits["Service"], ids: string[]) => Effect.Effect<A, E, UsageLimits>,
  ) {
    return runAppEffect(
      Effect.gen(function* () {
        const usageLimits = yield* UsageLimits
        const ids: string[] = []
        for (const limit of fields)
          ids.push(yield* usageLimits.create({ organizationId, fields: limit }))
        return yield* use(usageLimits, ids)
      }),
    )
  }

  test("counts each scope's subject separately and refuses once a limit is used up", async () => {
    const { organizationId, ada, grace } = await createSubjects()
    const failure = await withLimits(
      organizationId,
      [
        weeklyTokens,
        { ...weeklyTokens, name: "Team spend", scope: "tenant", metric: "spend", amount: "1" },
        { ...weeklyTokens, name: "Conversation", scope: "thread" },
      ],
      (usageLimits) =>
        Effect.gen(function* () {
          const limits = yield* usageLimits.applicable({ organizationId, listedIds: [] })
          yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 600, spend: "0.4" } })
          yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 400, spend: "0.4" } })
          yield* usageLimits.record({ limits, subject: grace, usage: { tokens: 10, spend: "0.1" } })

          const graceStatus = yield* usageLimits.status({ limits, subject: grace })
          expect(graceStatus.map(({ limit, used }) => [limit.name, used])).toEqual([
            ["Team spend", "0.9"],
            ["Weekly limit", "10"],
          ])
          yield* usageLimits.check({ limits, subject: grace })
          return yield* Effect.flip(usageLimits.check({ limits, subject: ada }))
        }),
    )
    expect(failure).toMatchObject({
      _tag: "UsageLimitReached",
      usageLimit: { name: "Weekly limit" },
    })
    expect(failure.retryAfterSeconds).toBeGreaterThan(6 * 24 * 3600)
  })

  test("restarts an ended window with only the new usage", async () => {
    const { organizationId, ada } = await createSubjects()
    const used = await withLimits(organizationId, [weeklyTokens], (usageLimits) =>
      Effect.gen(function* () {
        const limits = yield* usageLimits.applicable({ organizationId, listedIds: [] })
        yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 990, spend: "0" } })
        yield* Effect.promise(() =>
          db
            .update(usageLimitCounter)
            .set({ windowStartsAt: new Date(Date.now() - 8 * 86_400_000) }),
        )
        const [ended] = yield* usageLimits.status({ limits, subject: ada })
        expect(ended).toMatchObject({ used: "0", resetsAt: null })
        yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 5, spend: "0" } })
        return (yield* usageLimits.status({ limits, subject: ada }))[0]!.used
      }),
    )
    expect(used).toBe("5")
  })

  test("applies listed limits only to this organization's tokens and never disabled ones", async () => {
    const { organizationId } = await createSubjects()
    const names = await withLimits(
      organizationId,
      [
        weeklyTokens,
        { ...weeklyTokens, name: "Pro weekly", appliesByDefault: false },
        { ...weeklyTokens, name: "Paused", appliesByDefault: false, enabled: false },
      ],
      (usageLimits, [, pro, paused]) =>
        Effect.gen(function* () {
          const foreign = pro!.replace(organizationId, "01990a5d-ac96-774b-b942-6b13c85384cc")
          const unlisted = yield* usageLimits.applicable({ organizationId, listedIds: [foreign] })
          const listed = yield* usageLimits.applicable({
            organizationId,
            listedIds: [pro!, paused!],
          })
          return [unlisted, listed].map((limits) => limits.map((limit) => limit.name))
        }),
    )
    expect(names).toEqual([["Weekly limit"], ["Pro weekly", "Weekly limit"]])
  })

  test("a scope change discards counters that name the old scope's subjects", async () => {
    const { organizationId, ada } = await createSubjects()
    const counts = await withLimits(organizationId, [weeklyTokens], (usageLimits, [id]) =>
      Effect.gen(function* () {
        const limits = yield* usageLimits.applicable({ organizationId, listedIds: [] })
        yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 5, spend: "0" } })
        const update = { organizationId, usageLimitId: id!, lockVersion: 0 }
        yield* usageLimits.update({ ...update, fields: { ...weeklyTokens, amount: "2000" } })
        const kept = (yield* Effect.promise(() => db.select().from(usageLimitCounter))).length
        const fields = { ...weeklyTokens, scope: "tenant" } as const
        yield* usageLimits.update({ ...update, lockVersion: 1, fields })
        return [kept, (yield* Effect.promise(() => db.select().from(usageLimitCounter))).length]
      }),
    )
    expect(counts).toEqual([1, 0])
  })
})
