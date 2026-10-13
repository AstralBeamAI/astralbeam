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
        .returning(),
    ),
    Effect.flatMap((rows) => mutationResult(rows, options)),
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
  )!
}

// Tables are module constants, so each row decoder is built once rather than per mutation.
const lockedRowDecoders = new WeakMap<LockedTable, (row: unknown) => Effect.Effect<unknown>>()

function lockedRowDecoder(table: LockedTable) {
  let decode = lockedRowDecoders.get(table)
  if (!decode) {
    const rowSchema = createSelectSchema(table).pipe(
      Schema.fieldsAssign({ lockVersion: LockVersionSchema }),
    )
    const decodeRow = Schema.decodeUnknownEffect(rowSchema)
    decode = (row) => decodeRow(row).pipe(Effect.orDie)
    lockedRowDecoders.set(table, decode)
  }
  return decode
}

function mutationResult<TTable extends LockedTable>(
  rows: readonly unknown[],
  options: {
    expectedLockVersion: number
    table: TTable
  },
): Effect.Effect<InferSelectModel<TTable>, OptimisticLockError> {
  const row = rows[0]
  if (!row) {
    return Effect.fail(
      new OptimisticLockError({
        expectedLockVersion: options.expectedLockVersion,
        tableName: getTableName(options.table),
      }),
    )
  }
  return lockedRowDecoder(options.table)(row) as Effect.Effect<InferSelectModel<TTable>>
}
