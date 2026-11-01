import { OrganizationIdSchema } from "@/db/schema/organizations"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Client } from "pg"
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
import { parseUsageLimitId, type UsageLimitFields } from "./schemas.ts"
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
    const [org] = await db
      .insert(organization)
      .values({ domain: "example.com", name: "Acme", slug: "acme" })
      .returning()
    const organizationId = OrganizationIdSchema.make(org!.id)
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
          db.update(usageLimitCounter).set({ windowEndsAt: new Date(Date.now() - 1000) }),
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

  test("lists subjects in live windows by usage, most used first, a page at a time", async () => {
    const { organizationId, ada, grace } = await createSubjects()
    const pages = await withLimits(organizationId, [weeklyTokens], (usageLimits, [id]) =>
      Effect.gen(function* () {
        const limits = yield* usageLimits.applicable({ organizationId, listedIds: [] })
        yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 50, spend: "0" } })
        yield* usageLimits.record({ limits, subject: grace, usage: { tokens: 900, spend: "0" } })
        const input = { organizationId, usageLimitId: id! }
        const live = yield* usageLimits.subjects({ ...input, page: 1 })
        yield* Effect.promise(() =>
          db
            .update(usageLimitCounter)
            .set({ windowEndsAt: new Date(Date.now() - 1000) })
            .where(sql`${usageLimitCounter.tokens} = 50`),
        )
        const afterAdaEnded = yield* usageLimits.subjects({ ...input, page: 1 })
        const beyond = yield* usageLimits.subjects({ ...input, page: 2 })
        return [live, afterAdaEnded, beyond]
      }),
    )
    expect(
      pages.map(({ subjects, total }) => [
        total,
        subjects.map((subject) => [subject.tenantUser?.externalId, subject.used]),
      ]),
    ).toEqual([
      [
        2,
        [
          ["grace", "900"],
          ["ada", "50"],
        ],
      ],
      [1, [["grace", "900"]]],
      [1, []],
    ])
  })

  test("a window edit discards a first write that read the old definition before it", async () => {
    const { organizationId, ada } = await createSubjects()
    const [id] = await withLimits(organizationId, [weeklyTokens], (_usageLimits, ids) =>
      Effect.succeed(ids),
    )
    const rowId = parseUsageLimitId(id)!.id
    // A raw transaction replays recording's order: share-lock the limit, then write its counter.
    const recording = new Client({ connectionString: usageLimitIntegration.url })
    await recording.connect()
    try {
      await recording.query("begin")
      await recording.query("select id from usage_limit where id = $1 for share", [rowId])
      const edit = runAppEffect(
        Effect.flatMap(UsageLimits, (usageLimits) =>
          usageLimits.update({
            organizationId,
            usageLimitId: id!,
            lockVersion: 0,
            fields: { ...weeklyTokens, windowCount: 2 },
          }),
        ),
      )
      await expect
        .poll(
          async () =>
            (
              await recording.query<{ waiting: number }>(
                "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
              )
            ).rows[0]?.waiting,
        )
        .toBe(1)
      await recording.query(
        "insert into usage_limit_counter (organization_id, usage_limit_id, tenant_id, tenant_user_id, window_ends_at, tokens, spend) values ($1, $2, $3, $4, now() + interval '1 day', 900, 0)",
        [organizationId, rowId, ada.tenantId, ada.tenantUserId],
      )
      await recording.query("commit")
      await edit
    } finally {
      await recording.end()
    }
    expect(await db.select().from(usageLimitCounter)).toEqual([])
  })

  test("window and scope edits restart counting, while name and amount edits keep it", async () => {
    const { organizationId, ada } = await createSubjects()
    const counts = await withLimits(organizationId, [weeklyTokens], (usageLimits, [id]) =>
      Effect.gen(function* () {
        const limits = yield* usageLimits.applicable({ organizationId, listedIds: [] })
        const counted = Effect.promise(() => db.select().from(usageLimitCounter))
        const update = (lockVersion: number, fields: Partial<UsageLimitFields>) =>
          usageLimits.update({
            organizationId,
            usageLimitId: id!,
            lockVersion,
            fields: { ...weeklyTokens, ...fields },
          })
        const results: number[] = []
        for (const [lockVersion, fields] of [
          [0, { name: "Renamed", amount: "2000" }],
          [1, { windowType: "fixed", timeZone: "UTC" }],
          [2, { windowType: "fixed", timeZone: "Asia/Kolkata" }],
          [3, { windowType: "fixed", timeZone: "Asia/Kolkata", windowUnit: "day" }],
          [
            4,
            { windowType: "fixed", timeZone: "Asia/Kolkata", windowUnit: "day", scope: "tenant" },
          ],
        ] as const) {
          yield* usageLimits.record({ limits, subject: ada, usage: { tokens: 5, spend: "0" } })
          yield* update(lockVersion, fields)
          results.push((yield* counted).length)
        }
        return results
      }),
    )
    expect(counts).toEqual([1, 0, 0, 0, 0])
  })
})
