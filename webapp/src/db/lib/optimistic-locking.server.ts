import { setResponseStatus } from "@tanstack/react-start/server"
import { and, eq, getTableName, type InferSelectModel, type SQL, sql } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import type { AnyPgColumn, AnyPgTable, PgUpdateSetSource } from "drizzle-orm/pg-core"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { Schema } from "effect"

import { LockVersionSchema } from "@/lib/schemas"

import type { EffectDatabase } from "@/db"

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

export class OptimisticLockError extends Data.TaggedError("OptimisticLockError")<{
  readonly cause?: unknown
  readonly reason: "conflict" | "database" | "invalid-result" | "invalid-version"
  readonly expectedLockVersion: number
  readonly tableName: string
}> {}

export function optimisticLockConflict(message: string) {
  return Effect.sync(() => {
    setResponseStatus(409)
    return { ok: false as const, code: "stale" as const, message }
  })
}

export function catchOptimisticLockConflict(message: string) {
  return <Success, Failure, Requirements>(
    effect: Effect.Effect<Success, Failure, Requirements>,
  ) =>
    Effect.catchIf(
      effect,
      (error): error is Failure & OptimisticLockError =>
        error instanceof OptimisticLockError && error.reason === "conflict",
      () => optimisticLockConflict(message),
    )
}

export function updateWithOptimisticLock<
  TTable extends LockedTable,
>(
  options: OptimisticLockOptions<TTable> & {
    set: LockedUpdateSet<TTable>
  },
): Effect.Effect<
  InferSelectModel<TTable>,
  OptimisticLockError
> {
  return validateLockVersion(options).pipe(
    Effect.andThen(
      options.executor
        .update(options.table)
        .set({
          ...options.set,
          lockVersion: sql`${options.table.lockVersion} + 1`,
        })
        .where(lockedWhere(options))
        .returning().pipe(
          Effect.mapError((cause) => optimisticLockError("database", options, cause)),
        ),
    ),
    Effect.flatMap((rows) => mutationResult(rows, options)),
  )
}

export function deleteWithOptimisticLock<
  TTable extends LockedTable,
>(
  options: OptimisticLockOptions<TTable>,
): Effect.Effect<
  InferSelectModel<TTable>,
  OptimisticLockError
> {
  return validateLockVersion(options).pipe(
    Effect.andThen(
      options.executor
        .delete(options.table)
        .where(lockedWhere(options))
        .returning().pipe(
          Effect.mapError((cause) => optimisticLockError("database", options, cause)),
        ),
    ),
    Effect.flatMap((rows) => mutationResult(rows, options)),
  )
}

function validateLockVersion<TTable extends LockedTable>(
  options: { expectedLockVersion: number; table: TTable },
): Effect.Effect<void, OptimisticLockError> {
  return Schema.is(LockVersionSchema)(options.expectedLockVersion) ? Effect.void : Effect.fail(
    optimisticLockError("invalid-version", options),
  )
}

function optimisticLockError<TTable extends LockedTable>(
  reason: OptimisticLockError["reason"],
  options: { expectedLockVersion: number; table: TTable },
  cause?: unknown,
): OptimisticLockError {
  return new OptimisticLockError({
    ...(cause === undefined ? {} : { cause }),
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
  rows: readonly unknown[],
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
  const rowSchema = createSelectSchema(options.table).pipe(
    Schema.fieldsAssign({ lockVersion: LockVersionSchema }),
  )
  return Schema.decodeUnknownEffect(rowSchema)(row).pipe(
    Effect.map((decoded) => decoded as InferSelectModel<TTable>),
    Effect.mapError(() => optimisticLockError("invalid-result", options)),
  )
}
