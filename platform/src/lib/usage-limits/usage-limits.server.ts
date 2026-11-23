import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm"
import { BigDecimal, Clock, Context, DateTime, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { chatThread } from "@/db/schema/chat"
import { OrganizationIdSchema, tenant, tenantUser } from "@/db/schema/organizations"
import { usageLimit, usageLimitCounter } from "@/db/schema/usage-limits"
import {
  type UsageSubject,
  usageCounterIncrement,
  usageCounterKey,
  usageCountersWhere,
} from "./counters.ts"
import { UsageLimitChanged, UsageLimitNotFound, UsageLimitReached } from "./errors.ts"
import {
  formatUsageLimitId,
  parseUsageLimitId,
  USAGE_LIMIT_SUBJECTS_PAGE_SIZE,
  UsageLimitFieldsSchema,
  type UsageLimitFields,
} from "./schemas.ts"
import { usageLimitWindowEnd } from "./windows.ts"

/** A usage limit row. The dashboard addresses it by public ID, and enforcement by row ID. */
export type UsageLimit = typeof usageLimit.$inferSelect

/** One subject's usage in a limit's live window, named by its tenant, tenant user, or conversation. */
export type UsageLimitSubjectUsage = Effect.Success<
  ReturnType<UsageLimits["Service"]["subjects"]>
>["subjects"][number]

const decodeUsageLimitRows = Schema.decodeUnknownEffect(Schema.Array(usageLimit.schema), {
  onExcessProperty: "error",
})

const validateUsageLimitFields = Schema.decodeUnknownSync(UsageLimitFieldsSchema, {
  onExcessProperty: "error",
})

function publicUsageLimit(row: UsageLimit): UsageLimit {
  return { ...row, id: formatUsageLimitId(row) }
}

/** Resolves a public limit ID to its row ID, failing alike for malformed and foreign IDs. */
const ownUsageLimitId = Effect.fnUntraced(function* (organizationId: string, usageLimitId: string) {
  const parsed = parseUsageLimitId(usageLimitId)
  if (parsed?.organizationId !== organizationId) return yield* new UsageLimitNotFound()
  return parsed.id
})

const usageLimitChangedTags = ["UsageLimitNotFound", "NotFound", "StaleWrite"] as const

type UsageLimitWriteTarget = {
  readonly organizationId: string
  readonly usageLimitId: string
  readonly lockVersion: number
}

export class UsageLimits extends Context.Service<UsageLimits>()(
  "astralbeam/usage-limits/UsageLimits",
  {
    make: Effect.gen(function* () {
      const db = yield* Database
      const useDatabase = Effect.provideService(Database, db)

      const list = Effect.fn("UsageLimits.list")(function* (organizationId: string) {
        const rows = yield* db
          .select()
          .from(usageLimit)
          .where(eq(usageLimit.organizationId, organizationId))
          .orderBy(asc(usageLimit.name), asc(usageLimit.id))
        return (yield* decodeUsageLimitRows(rows)).map(publicUsageLimit)
      }, Effect.orDie)

      const get = Effect.fn("UsageLimits.get")(function* (input: {
        readonly organizationId: string
        readonly usageLimitId: string
      }) {
        const id = yield* ownUsageLimitId(input.organizationId, input.usageLimitId)
        const rows = yield* db
          .select()
          .from(usageLimit)
          .where(and(eq(usageLimit.organizationId, input.organizationId), eq(usageLimit.id, id)))
          .limit(1)
          .pipe(Effect.orDie)
        const [row] = yield* decodeUsageLimitRows(rows).pipe(Effect.orDie)
        if (!row) return yield* new UsageLimitNotFound()
        return publicUsageLimit(row)
      })

      const create = Effect.fn("UsageLimits.create")(
        (input: { readonly organizationId: string; readonly fields: UsageLimitFields }) =>
          usageLimit
            .insert({
              ...validateUsageLimitFields(input.fields),
              organizationId: input.organizationId,
            })
            .pipe(Effect.map(formatUsageLimitId)),
        useDatabase,
        mapDatabaseErrors(),
      )

      const update = Effect.fn("UsageLimits.update")(
        function* (
          input: UsageLimitWriteTarget & {
            readonly fields: UsageLimitFields | Pick<UsageLimitFields, "enabled">
          },
        ) {
          const { organizationId, usageLimitId, lockVersion } = input
          const fields = { ...input.fields }
          const id = yield* ownUsageLimitId(organizationId, usageLimitId)
          const target = { organizationId, id, lockVersion }
          if (!("scope" in fields)) {
            yield* usageLimit.update(target, { enabled: fields.enabled })
            return
          }
          yield* usageLimit.update(target, validateUsageLimitFields(fields), {
            // The model locks the limit before counters, as recording does, so a first write
            // using the old definition commits before this decides what to discard.
            onLocked: (current) =>
              Effect.gen(function* () {
                if (current.lockVersion !== lockVersion) return
                // Counters belong to the old scope's subjects and the old window's end, so changing
                // either starts counting afresh. Name, amount, and metric edits keep the counts.
                if (
                  (["scope", "windowType", "windowCount", "windowUnit", "timeZone"] as const).some(
                    (field) => current[field] !== fields[field],
                  )
                )
                  yield* db
                    .delete(usageLimitCounter)
                    .where(
                      and(
                        eq(
                          usageLimitCounter.organizationId,
                          OrganizationIdSchema.make(current.organizationId),
                        ),
                        eq(usageLimitCounter.usageLimitId, current.id),
                      ),
                    )
              }),
          })
        },
        useDatabase,
        mapDatabaseErrors(),
        Effect.catchTag(usageLimitChangedTags, () => new UsageLimitChanged()),
      )

      const setEnabled = ({ enabled, ...target }: UsageLimitWriteTarget & { enabled: boolean }) =>
        update({ ...target, fields: { enabled } })

      const remove = Effect.fn("UsageLimits.remove")(
        function* (input: UsageLimitWriteTarget) {
          yield* usageLimit.delete({
            ...input,
            id: yield* ownUsageLimitId(input.organizationId, input.usageLimitId),
          })
        },
        useDatabase,
        mapDatabaseErrors(),
        Effect.catchTag(usageLimitChangedTags, () => new UsageLimitChanged()),
      )

      const applicable = Effect.fn("UsageLimits.applicable")(function* (input: {
        readonly organizationId: string
        readonly listedIds: readonly string[]
      }) {
        const listed = input.listedIds.flatMap((publicId) => {
          const parsed = parseUsageLimitId(publicId)
          return parsed?.organizationId === input.organizationId ? [parsed.id] : []
        })
        const rows = yield* db
          .select()
          .from(usageLimit)
          .where(
            and(
              eq(usageLimit.organizationId, input.organizationId),
              eq(usageLimit.enabled, true),
              listed.length
                ? or(eq(usageLimit.appliesByDefault, true), inArray(usageLimit.id, listed))
                : eq(usageLimit.appliesByDefault, true),
            ),
          )
          .orderBy(asc(usageLimit.name), asc(usageLimit.id))
        return yield* decodeUsageLimitRows(rows)
      }, Effect.orDie)

      const status = Effect.fn("UsageLimits.status")(function* (input: {
        readonly limits: readonly UsageLimit[]
        readonly subject: UsageSubject
      }) {
        const now = DateTime.toDateUtc(yield* DateTime.now)
        const keyed = input.limits.flatMap((limit) => {
          const key = usageCounterKey(limit.scope, input.subject)
          return key ? [{ limit, key }] : []
        })
        if (keyed.length === 0) return []
        const counters = yield* db
          .select()
          .from(usageLimitCounter)
          .where(
            usageCountersWhere(
              input.subject.organizationId,
              keyed.map(({ limit, key }) => ({ usageLimitId: limit.id, key })),
            ),
          )
          .pipe(Effect.orDie)
        return keyed.map(({ limit, key }) => {
          const counter = counters.find(
            (row) =>
              row.usageLimitId === limit.id &&
              row.tenantId === key.tenantId &&
              row.tenantUserId === key.tenantUserId &&
              row.threadId === key.threadId,
          )
          const live = counter && counter.windowEndsAt > now
          return {
            limit: publicUsageLimit(limit),
            used: live ? (limit.metric === "tokens" ? String(counter.tokens) : counter.spend) : "0",
            resetsAt: live ? counter.windowEndsAt : null,
          }
        })
      })

      const check = Effect.fn("UsageLimits.check")(function* (input: {
        readonly limits: readonly UsageLimit[]
        readonly subject: UsageSubject
      }): Effect.fn.Return<void, UsageLimitReached> {
        const reached = (yield* status(input))
          .filter(({ limit, used }) =>
            BigDecimal.isGreaterThanOrEqualTo(
              BigDecimal.fromStringUnsafe(used),
              BigDecimal.fromStringUnsafe(limit.amount),
            ),
          )
          .toSorted((left, right) => right.resetsAt!.getTime() - left.resetsAt!.getTime())[0]
        if (!reached) return
        const now = yield* Clock.currentTimeMillis
        return yield* new UsageLimitReached({
          usageLimit: { name: reached.limit.name, resetsAt: reached.resetsAt!.toISOString() },
          retryAfterSeconds: Math.max(1, Math.ceil((reached.resetsAt!.getTime() - now) / 1000)),
        })
      })

      /** Subjects with usage in their live window, most used first. Pages start at 1. */
      const subjects = Effect.fn("UsageLimits.subjects")(function* (input: {
        readonly organizationId: UsageSubject["organizationId"]
        readonly usageLimitId: string
        readonly page: number
      }) {
        const limit = yield* get(input)
        const now = DateTime.toDateUtc(yield* DateTime.now)
        const live = and(
          eq(usageLimitCounter.organizationId, input.organizationId),
          eq(usageLimitCounter.usageLimitId, parseUsageLimitId(limit.id)!.id),
          gt(usageLimitCounter.windowEndsAt, now),
        )
        const used = limit.metric === "tokens" ? usageLimitCounter.tokens : usageLimitCounter.spend
        const [subjects, total] = yield* Effect.all(
          [
            db
              .select({
                id: usageLimitCounter.id,
                resetsAt: usageLimitCounter.windowEndsAt,
                used: sql<string>`${used}::text`,
                tenant: { externalId: tenant.externalId, name: tenant.name },
                tenantUser: { externalId: tenantUser.externalId, name: tenantUser.name },
                threadTitle: chatThread.title,
              })
              .from(usageLimitCounter)
              .leftJoin(
                tenant,
                and(
                  eq(tenant.organizationId, usageLimitCounter.organizationId),
                  eq(tenant.id, usageLimitCounter.tenantId),
                ),
              )
              .leftJoin(
                tenantUser,
                and(
                  eq(tenantUser.organizationId, usageLimitCounter.organizationId),
                  eq(tenantUser.tenantId, usageLimitCounter.tenantId),
                  eq(tenantUser.id, usageLimitCounter.tenantUserId),
                ),
              )
              .leftJoin(
                chatThread,
                and(
                  eq(chatThread.organizationId, usageLimitCounter.organizationId),
                  eq(chatThread.tenantId, usageLimitCounter.tenantId),
                  eq(chatThread.id, usageLimitCounter.threadId),
                ),
              )
              .where(live)
              .orderBy(desc(used), asc(usageLimitCounter.id))
              .limit(USAGE_LIMIT_SUBJECTS_PAGE_SIZE)
              .offset((input.page - 1) * USAGE_LIMIT_SUBJECTS_PAGE_SIZE),
            db.$count(usageLimitCounter, live),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.orDie)
        return { usageLimit: limit, total, subjects }
      })

      const record = Effect.fn("UsageLimits.record")(function* (input: {
        readonly limits: readonly UsageLimit[]
        readonly subject: UsageSubject
        readonly usage: { readonly tokens: number; readonly spend: string }
      }) {
        if (input.limits.length === 0) return
        const now = DateTime.toDateUtc(yield* DateTime.now)
        yield* db.transaction((transaction) =>
          Effect.gen(function* () {
            // Reread under a share lock, so an edit that discards counters waits for this write or
            // runs after it, and a run that began before the edit counts under the new definition.
            const rows = yield* transaction
              .select()
              .from(usageLimit)
              .where(
                and(
                  eq(usageLimit.organizationId, input.subject.organizationId),
                  eq(usageLimit.enabled, true),
                  inArray(
                    usageLimit.id,
                    input.limits.map((limit) => limit.id),
                  ),
                ),
              )
              .orderBy(asc(usageLimit.id))
              .for("share")
            const counters = rows.flatMap((limit) => {
              const key = usageCounterKey(limit.scope, input.subject)
              if (!key) return []
              return [
                {
                  organizationId: input.subject.organizationId,
                  usageLimitId: limit.id,
                  ...key,
                  windowEndsAt: usageLimitWindowEnd(limit, now),
                  ...input.usage,
                },
              ]
            })
            if (counters.length)
              yield* transaction
                .insert(usageLimitCounter)
                .values(counters)
                .onConflictDoUpdate({
                  target: [
                    usageLimitCounter.organizationId,
                    usageLimitCounter.usageLimitId,
                    usageLimitCounter.tenantId,
                    usageLimitCounter.tenantUserId,
                    usageLimitCounter.threadId,
                  ],
                  set: usageCounterIncrement(now),
                })
          }),
        )
      }, Effect.orDie)

      return {
        list,
        get,
        create,
        update,
        setEnabled,
        remove,
        applicable,
        status,
        check,
        subjects,
        record,
      }
    }),
  },
) {
  static readonly layerNoDeps = Layer.effect(this, this.make)

  static readonly layer = UsageLimits.layerNoDeps.pipe(Layer.provide(Database.layer))
}
