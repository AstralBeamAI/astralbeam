import { and, eq, getTableName, type InferSelectModel, type SQL, sql } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import type { AnyPgColumn, AnyPgTable, PgUpdateSetSource } from "drizzle-orm/pg-core"
import { Effect, Schema } from "effect"

import { LockVersionSchema } from "@/lib/schemas"

import type { EffectDatabase } from "@/db/database"

type LockedTable = AnyPgTable & {
  id: AnyPgColumn<{ notNull: true }>
  lockVersion: AnyPgColumn<{ data: number; notNull: true }>
}

type LockedUpdateSet<TTable extends LockedTable> = Omit<
  PgUpdateSetSource<TTable>,
  "id" | "lockVersion"
>

type OptimisticLockExecutor = Pick<EffectDatabase, "delete" | "update">

type OptimisticLockOptions<TTable extends LockedTable> = {
  executor: OptimisticLockExecutor
  table: TTable
  id: InferSelectModel<TTable>["id"]
  scope?: SQL
  expectedLockVersion: number
}

/** No row matched the expected lock version, because it changed or no longer exists. */
export class OptimisticLockError extends Schema.TaggedError<OptimisticLockError>()(
  "OptimisticLockError",
  { expectedLockVersion: Schema.Int, tableName: Schema.String },
  { httpApiStatus: 409 },
) {
  override readonly message = "This record changed since you opened it. Reload and try again"
}

export function updateWithOptimisticLock<TTable extends LockedTable>(
  options: OptimisticLockOptions<TTable> & {
    set: LockedUpdateSet<TTable>
  },
): Effect.Effect<InferSelectModel<TTable>, OptimisticLockError | EffectDrizzleQueryError> {
  return validateLockVersion(options).pipe(
    Effect.andThen(
      options.executor
        .update(options.table)
        .set({
          ...options.set,
          lockVersion: sql`${options.table.lockVersion} + 1`,
        })
        .where(lockedWhere(options))
        .returning({ row: options.table }),
    ),
    Effect.flatMap((rows) => mutationResult(rows[0]?.row, options)),
  )
}

export function deleteWithOptimisticLock<TTable extends LockedTable>(
  options: OptimisticLockOptions<TTable>,
): Effect.Effect<void, OptimisticLockError | EffectDrizzleQueryError> {
  return validateLockVersion(options).pipe(
    Effect.andThen(
      // A deleted row's credentials may be unreadable. https://orm.drizzle.team/docs/delete#delete-with-returning
      options.executor
        .delete(options.table)
        .where(lockedWhere(options))
        .returning({ id: options.table.id }),
    ),
    Effect.flatMap((rows) =>
      rows.length > 0
        ? Effect.void
        : Effect.fail(
            new OptimisticLockError({
              expectedLockVersion: options.expectedLockVersion,
              tableName: getTableName(options.table),
            }),
          ),
    ),
  )
}

function validateLockVersion<TTable extends LockedTable>(options: {
  expectedLockVersion: number
  table: TTable
}): Effect.Effect<void> {
  return Schema.is(LockVersionSchema)(options.expectedLockVersion)
    ? Effect.void
    : Effect.die(new Error(`Invalid lock version for ${getTableName(options.table)}`))
}

function lockedWhere<TTable extends LockedTable>(options: {
  expectedLockVersion: number
  id: InferSelectModel<TTable>["id"]
  scope?: SQL
  table: TTable
}) {
  return and(
    eq(options.table.id, options.id),
    options.scope,
    eq(options.table.lockVersion, options.expectedLockVersion),
  )
}

// Tables are module constants, so each row schema is built once rather than per mutation.
const lockedRowSchemas = new WeakMap<LockedTable, Schema.Codec<InferSelectModel<LockedTable>>>()

function lockedRowSchema(table: LockedTable) {
  let schema = lockedRowSchemas.get(table)
  if (!schema) {
    schema = createSelectSchema(table).pipe(Schema.fieldsAssign({ lockVersion: LockVersionSchema }))
    lockedRowSchemas.set(table, schema)
  }
  return schema
}

function mutationResult<TTable extends LockedTable>(
  row: InferSelectModel<TTable> | undefined,
  options: {
    expectedLockVersion: number
    table: TTable
  },
): Effect.Effect<InferSelectModel<TTable>, OptimisticLockError> {
  if (!row) {
    return Effect.fail(
      new OptimisticLockError({
        expectedLockVersion: options.expectedLockVersion,
        tableName: getTableName(options.table),
      }),
    )
  }
  return Schema.decodeEffect(lockedRowSchema(options.table))(row).pipe(Effect.orDie, Effect.as(row))
}
