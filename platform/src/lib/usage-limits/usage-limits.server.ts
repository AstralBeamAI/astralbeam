import { and, asc, count, desc, eq, gt, inArray, or } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database"
import { deleteWithOptimisticLock, updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { chatThread } from "@/db/schema/chat"
import { tenant, tenantUser } from "@/db/schema/organizations"
import { usageLimit, usageLimitCounter } from "@/db/schema/usage-limits"
import { DisplayNameSchema, LockVersionSchema, UuidV7Schema } from "@/lib/schemas"
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
  TimeZoneSchema,
  USAGE_LIMIT_SUBJECTS_PAGE_SIZE,
  type UsageLimitFields,
} from "./schemas.ts"
import { usageLimitWindowEnd } from "./windows.ts"

const UsageLimitRowSchema = createSelectSchema(usageLimit, {
  id: UuidV7Schema,
  organizationId: UuidV7Schema,
  name: DisplayNameSchema,
  timeZone: Schema.NullOr(TimeZoneSchema),
  lockVersion: LockVersionSchema,
})

/** A usage limit row. The dashboard addresses it by public ID, and enforcement by row ID. */
export type UsageLimit = typeof UsageLimitRowSchema.Type

/** A limit's usage so far in a subject's live window, as a decimal string in its own metric. */
export interface UsageLimitStatus {
  readonly limit: UsageLimit
  readonly used: string
  /** Null until the subject's first usage opens a window. */
  readonly resetsAt: Date | null
}

/** One subject's usage in a limit's live window, named by its tenant, tenant user, or conversation. */
export interface UsageLimitSubjectUsage {
  readonly id: string
  readonly tenant: { readonly name: string | null; readonly externalId: string } | null
  readonly tenantUser: { readonly name: string | null; readonly externalId: string } | null
  readonly threadTitle: string | null
  readonly used: string
  readonly resetsAt: Date
}

const decodeUsageLimitRows = Schema.decodeUnknownEffect(Schema.Array(UsageLimitRowSchema), {
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

export class UsageLimits extends Context.Service<
  UsageLimits,
  {
    readonly list: (organizationId: string) => Effect.Effect<readonly UsageLimit[]>
    readonly get: (input: {
      readonly organizationId: string
      readonly usageLimitId: string
    }) => Effect.Effect<UsageLimit, UsageLimitNotFound>
    /** Returns the new limit's public ID. */
    readonly create: (input: {
      readonly organizationId: string
      readonly fields: UsageLimitFields
    }) => Effect.Effect<string>
    readonly update: (input: {
      readonly organizationId: string
      readonly usageLimitId: string
      readonly lockVersion: number
      readonly fields: UsageLimitFields
    }) => Effect.Effect<void, UsageLimitChanged>
    /** The list page's kill switch, which leaves every other field as it is. */
    readonly setEnabled: (input: {
      readonly organizationId: string
      readonly usageLimitId: string
      readonly lockVersion: number
      readonly enabled: boolean
    }) => Effect.Effect<void, UsageLimitChanged>
    readonly remove: (input: {
      readonly organizationId: string
      readonly usageLimitId: string
      readonly lockVersion: number
    }) => Effect.Effect<void, UsageLimitChanged>
    /** Enabled default limits, plus enabled limits whose public IDs a chat token lists. */
    readonly applicable: (input: {
      readonly organizationId: string
      readonly listedIds: readonly string[]
    }) => Effect.Effect<readonly UsageLimit[]>
    /** Each limit's usage in the subject's live window, and when that window resets. */
    readonly status: (input: {
      readonly limits: readonly UsageLimit[]
      readonly subject: UsageSubject
    }) => Effect.Effect<readonly UsageLimitStatus[]>
    /** Fails when any limit is used up, naming the one that resets last. */
    readonly check: (input: {
      readonly limits: readonly UsageLimit[]
      readonly subject: UsageSubject
    }) => Effect.Effect<void, UsageLimitReached>
    /** Subjects with usage in their live window, most used first. Pages start at 1. */
    readonly subjects: (input: {
      readonly organizationId: string
      readonly usageLimitId: string
      readonly page: number
    }) => Effect.Effect<
      { readonly subjects: readonly UsageLimitSubjectUsage[]; readonly total: number },
      UsageLimitNotFound
    >
    readonly record: (input: {
      readonly limits: readonly UsageLimit[]
      readonly subject: UsageSubject
      readonly usage: { readonly tokens: number; readonly spend: string }
    }) => Effect.Effect<void>
  }
>()("astralbeam/usage-limits/UsageLimits") {
  static readonly layerNoDeps = Layer.effect(
    UsageLimits,
    Effect.gen(function* () {
      const db = yield* Database

      const list = Effect.fn("UsageLimits.list")(function* (organizationId: string) {
        const rows = yield* db
          .select()
          .from(usageLimit)
          .where(eq(usageLimit.organizationId, organizationId))
          .orderBy(asc(usageLimit.name), asc(usageLimit.id))
        return (yield* decodeUsageLimitRows(rows)).map(publicUsageLimit)
      }, Effect.orDie)

      const get = Effect.fn("UsageLimits.get")(function* (input: {
        organizationId: string
        usageLimitId: string
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

      const create = Effect.fn("UsageLimits.create")(function* (input: {
        organizationId: string
        fields: UsageLimitFields
      }) {
        const [created] = yield* db
          .insert(usageLimit)
          .values({ organizationId: input.organizationId, ...input.fields })
          .returning({ id: usageLimit.id })
        return formatUsageLimitId({ organizationId: input.organizationId, id: created!.id })
      }, mapDatabaseErrors())

      const update = Effect.fn("UsageLimits.update")(
        function* (input: {
          organizationId: string
          usageLimitId: string
          lockVersion: number
          fields: UsageLimitFields
        }) {
          const id = yield* ownUsageLimitId(input.organizationId, input.usageLimitId)
          yield* db.transaction((transaction) =>
            Effect.gen(function* () {
              // Lock the limit before touching counters, as recording does, so a first write that
              // already read the old definition commits before this decides what to discard.
              const [current] = yield* transaction
                .select()
                .from(usageLimit)
                .where(
                  and(eq(usageLimit.organizationId, input.organizationId), eq(usageLimit.id, id)),
                )
                .for("update")
              // Counters belong to the old scope's subjects and the old window's end, so changing
              // either starts counting afresh. Name, amount, and metric edits keep the counts.
              const fields = input.fields
              if (
                current &&
                (current.scope !== fields.scope ||
                  current.windowType !== fields.windowType ||
                  current.windowCount !== fields.windowCount ||
                  current.windowUnit !== fields.windowUnit ||
                  current.timeZone !== fields.timeZone)
              )
                yield* transaction
                  .delete(usageLimitCounter)
                  .where(
                    and(
                      eq(usageLimitCounter.organizationId, input.organizationId),
                      eq(usageLimitCounter.usageLimitId, id),
                    ),
                  )
              yield* updateWithOptimisticLock({
                executor: transaction,
                table: usageLimit,
                id,
                scope: eq(usageLimit.organizationId, input.organizationId),
                expectedLockVersion: input.lockVersion,
                set: input.fields,
              })
            }),
          )
        },
        mapDatabaseErrors(),
        Effect.catchTags({
          UsageLimitNotFound: () => Effect.fail(new UsageLimitChanged()),
          OptimisticLockError: () => Effect.fail(new UsageLimitChanged()),
        }),
      )

      const setEnabled = Effect.fn("UsageLimits.setEnabled")(
        function* (input: {
          organizationId: string
          usageLimitId: string
          lockVersion: number
          enabled: boolean
        }) {
          yield* updateWithOptimisticLock({
            executor: db,
            table: usageLimit,
            id: yield* ownUsageLimitId(input.organizationId, input.usageLimitId),
            scope: eq(usageLimit.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
            set: { enabled: input.enabled },
          })
        },
        mapDatabaseErrors(),
        Effect.catchTags({
          UsageLimitNotFound: () => Effect.fail(new UsageLimitChanged()),
          OptimisticLockError: () => Effect.fail(new UsageLimitChanged()),
        }),
      )

      const remove = Effect.fn("UsageLimits.remove")(
        function* (input: { organizationId: string; usageLimitId: string; lockVersion: number }) {
          yield* deleteWithOptimisticLock({
            executor: db,
            table: usageLimit,
            id: yield* ownUsageLimitId(input.organizationId, input.usageLimitId),
            scope: eq(usageLimit.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
          })
        },
        mapDatabaseErrors(),
        Effect.catchTags({
          UsageLimitNotFound: () => Effect.fail(new UsageLimitChanged()),
          OptimisticLockError: () => Effect.fail(new UsageLimitChanged()),
        }),
      )

      const applicable = Effect.fn("UsageLimits.applicable")(function* (input: {
        organizationId: string
        listedIds: readonly string[]
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
        limits: readonly UsageLimit[]
        subject: UsageSubject
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
        limits: readonly UsageLimit[]
        subject: UsageSubject
      }) {
        const reached = (yield* status(input))
          .filter(({ limit, used }) => Number(used) >= Number(limit.amount))
          .toSorted((left, right) => right.resetsAt!.getTime() - left.resetsAt!.getTime())[0]
        if (!reached) return
        const now = yield* Clock.currentTimeMillis
        return yield* new UsageLimitReached({
          usageLimit: { name: reached.limit.name, resetsAt: reached.resetsAt!.toISOString() },
          retryAfterSeconds: Math.max(1, Math.ceil((reached.resetsAt!.getTime() - now) / 1000)),
        })
      })

      const subjects = Effect.fn("UsageLimits.subjects")(function* (input: {
        organizationId: string
        usageLimitId: string
        page: number
      }) {
        const limit = yield* get(input)
        const now = DateTime.toDateUtc(yield* DateTime.now)
        const live = and(
          eq(usageLimitCounter.organizationId, input.organizationId),
          eq(usageLimitCounter.usageLimitId, parseUsageLimitId(limit.id)!.id),
          gt(usageLimitCounter.windowEndsAt, now),
        )
        const used = limit.metric === "tokens" ? usageLimitCounter.tokens : usageLimitCounter.spend
        const [rows, [counted]] = yield* Effect.all(
          [
            db
              .select({
                id: usageLimitCounter.id,
                windowEndsAt: usageLimitCounter.windowEndsAt,
                tokens: usageLimitCounter.tokens,
                spend: usageLimitCounter.spend,
                tenantName: tenant.name,
                tenantExternalId: tenant.externalId,
                tenantUserName: tenantUser.name,
                tenantUserExternalId: tenantUser.externalId,
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
            db.select({ total: count() }).from(usageLimitCounter).where(live),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.orDie)
        return {
          total: counted?.total ?? 0,
          subjects: rows.map((row) => ({
            id: row.id,
            tenant:
              row.tenantExternalId === null
                ? null
                : { name: row.tenantName, externalId: row.tenantExternalId },
            tenantUser:
              row.tenantUserExternalId === null
                ? null
                : { name: row.tenantUserName, externalId: row.tenantUserExternalId },
            threadTitle: row.threadTitle,
            used: limit.metric === "tokens" ? String(row.tokens) : row.spend,
            resetsAt: row.windowEndsAt,
          })),
        }
      })

      const record = Effect.fn("UsageLimits.record")(function* (input: {
        limits: readonly UsageLimit[]
        subject: UsageSubject
        usage: { readonly tokens: number; readonly spend: string }
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
              .for("share")
            for (const limit of rows) {
              const key = usageCounterKey(limit.scope, input.subject)
              if (!key) continue
              yield* transaction
                .insert(usageLimitCounter)
                .values({
                  organizationId: input.subject.organizationId,
                  usageLimitId: limit.id,
                  ...key,
                  windowEndsAt: usageLimitWindowEnd(
                    { ...limit, timeZone: limit.timeZone ?? null },
                    now,
                  ),
                  ...input.usage,
                })
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
            }
          }),
        )
      }, Effect.orDie)

      return UsageLimits.of({
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
      })
    }),
  )

  static readonly layer = UsageLimits.layerNoDeps.pipe(Layer.provide(Database.layer))
}
