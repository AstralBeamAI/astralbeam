import {
  and,
  type AnyRelations,
  eq,
  getTableName,
  type InferSelectModel,
  type SQL,
  sql,
} from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import type {
  AnyPgColumn,
  AnyPgTable,
  PgAsyncDatabase,
  PgQueryResultHKT,
  PgUpdateSetSource,
} from "drizzle-orm/pg-core"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { Schema } from "effect"

type LockedTable = AnyPgTable & {
  id: AnyPgColumn<{ notNull: true }>
  lockVersion: AnyPgColumn<{ data: number; notNull: true }>
}

type LockedUpdateSet<TTable extends LockedTable> = Omit<
  PgUpdateSetSource<TTable>,
  "id" | "lockVersion"
>

type OptimisticLockOptions<
  TTable extends LockedTable,
  TQueryResult extends PgQueryResultHKT,
  TRelations extends AnyRelations,
> = {
  executor: PgAsyncDatabase<TQueryResult, TRelations>
  table: TTable
  id: InferSelectModel<TTable>["id"]
  scope?: SQL
  expectedLockVersion: number
}

export class OptimisticLockError extends Data.TaggedError("OptimisticLockError")<{
  readonly reason: "conflict" | "database" | "invalid-result" | "invalid-version"
  readonly expectedLockVersion: number
  readonly tableName: string
}> {}

export function updateWithOptimisticLock<
  TTable extends LockedTable,
  TQueryResult extends PgQueryResultHKT,
  TRelations extends AnyRelations,
>(
  options: OptimisticLockOptions<TTable, TQueryResult, TRelations> & {
    set: LockedUpdateSet<TTable>
  },
): Effect.Effect<
  InferSelectModel<TTable>,
  OptimisticLockError
> {
  return Effect.gen(function* () {
    yield* validateLockVersion(options)
    const rows = yield* Effect.tryPromise({
      try: () =>
        options.executor
          .update(options.table)
          .set({
            ...options.set,
            lockVersion: sql`${options.table.lockVersion} + 1`,
          } as PgUpdateSetSource<TTable>)
          .where(lockedWhere(options))
          .returning() as Promise<InferSelectModel<TTable>[]>,
      catch: () => optimisticLockError("database", options),
    })
    return yield* mutationResult(rows, options)
  })
}

export function deleteWithOptimisticLock<
  TTable extends LockedTable,
  TQueryResult extends PgQueryResultHKT,
  TRelations extends AnyRelations,
>(
  options: OptimisticLockOptions<TTable, TQueryResult, TRelations>,
): Effect.Effect<
  InferSelectModel<TTable>,
  OptimisticLockError
> {
  return Effect.gen(function* () {
    yield* validateLockVersion(options)
    const rows = yield* Effect.tryPromise({
      try: () =>
        options.executor
          .delete(options.table)
          .where(lockedWhere(options))
          .returning() as Promise<InferSelectModel<TTable>[]>,
      catch: () => optimisticLockError("database", options),
    })
    return yield* mutationResult(rows, options)
  })
}

function validateLockVersion<TTable extends LockedTable>(
  options: { expectedLockVersion: number; table: TTable },
): Effect.Effect<void, OptimisticLockError> {
  return Number.isSafeInteger(options.expectedLockVersion) && options.expectedLockVersion >= 0
    ? Effect.void
    : Effect.fail(
      optimisticLockError("invalid-version", options),
    )
}

function optimisticLockError<TTable extends LockedTable>(
  reason: OptimisticLockError["reason"],
  options: { expectedLockVersion: number; table: TTable },
): OptimisticLockError {
  return new OptimisticLockError({
    reason,
    expectedLockVersion: options.expectedLockVersion,
    tableName: getTableName(options.table),
  })
}

function lockedWhere<TTable extends LockedTable>(
  options: {
    expectedLockVersion: number
    id: InferSelectModel<TTable>["id"]
    scope?: SQL
    table: TTable
  },
) {
  return and(
    eq(options.table.id, options.id),
    options.scope,
    eq(options.table.lockVersion, options.expectedLockVersion),
  )!
}

function mutationResult<TTable extends LockedTable>(
  rows: InferSelectModel<TTable>[],
  options: {
    expectedLockVersion: number
    table: TTable
  },
): Effect.Effect<InferSelectModel<TTable>, OptimisticLockError> {
  const row = rows[0]
  if (!row) {
    return Effect.fail(
      optimisticLockError("conflict", options),
    )
  }
  return Schema.decodeUnknownEffect(createSelectSchema(options.table))(row).pipe(
    Effect.mapError(() => optimisticLockError("invalid-result", options)),
  )
}
