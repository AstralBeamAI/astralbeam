import { and, asc, eq } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import { Context, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database"
import { deleteWithOptimisticLock, updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { usageLimit } from "@/db/schema/usage-limits"
import { DisplayNameSchema, LockVersionSchema, UuidV7Schema } from "@/lib/schemas"
import { UsageLimitChanged, UsageLimitNotFound } from "./errors.ts"
import {
  formatUsageLimitId,
  parseUsageLimitId,
  TimeZoneSchema,
  type UsageLimitFields,
} from "./schemas.ts"

const UsageLimitRowSchema = createSelectSchema(usageLimit, {
  id: UuidV7Schema,
  organizationId: UuidV7Schema,
  name: DisplayNameSchema,
  timeZone: Schema.NullOr(TimeZoneSchema),
  lockVersion: LockVersionSchema,
})

/** A usage limit as the dashboard sees it, addressed by its public ID. */
export type UsageLimit = typeof UsageLimitRowSchema.Type

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
          yield* updateWithOptimisticLock({
            executor: db,
            table: usageLimit,
            id: yield* ownUsageLimitId(input.organizationId, input.usageLimitId),
            scope: eq(usageLimit.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
            set: input.fields,
          })
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

      return UsageLimits.of({ list, get, create, update, setEnabled, remove })
    }),
  )

  static readonly layer = UsageLimits.layerNoDeps.pipe(Layer.provide(Database.layer))
}
