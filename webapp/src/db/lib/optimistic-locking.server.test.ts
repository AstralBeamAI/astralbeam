import { eq, type SQL } from "drizzle-orm"
import { PgDialect, snakeCase, text } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import { describe, expect, test } from "vitest"

import type { EffectDatabase } from "@/db"
import { lockVersion, uuidV7PrimaryKey } from "./postgresql-types.server.ts"
import {
  deleteWithOptimisticLock,
  OptimisticLockError,
  updateWithOptimisticLock,
} from "./optimistic-locking.server.ts"

const lockedRecord = snakeCase.table("locked_record", {
  id: uuidV7PrimaryKey(),
  name: text().notNull(),
  lockVersion: lockVersion(),
})

type LockedRecord = typeof lockedRecord.$inferSelect
type MutationCall = {
  operation: "delete" | "update"
  set?: Record<string, unknown>
  where?: SQL
}

describe("optimistic locking", () => {
  test("updates the row only at the expected version and increments once", async () => {
    const updated: LockedRecord = {
      id: "01992a80-1d71-7f24-a150-f1177e3f6419",
      lockVersion: 4,
      name: "updated",
    }
    const { calls, executor } = createExecutor([updated])

    await expect(
      Effect.runPromise(
        updateWithOptimisticLock({
          executor,
          table: lockedRecord,
          id: updated.id,
          scope: eq(lockedRecord.name, "current"),
          expectedLockVersion: 3,
          set: { name: updated.name },
        }),
      ),
    ).resolves.toEqual(updated)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.operation).toBe("update")
    expect(calls[0]?.set?.name).toBe("updated")
    expect(toQuery(calls[0]?.set?.lockVersion as SQL)).toEqual({
      params: [],
      sql: '"locked_record"."lock_version" + 1',
    })
    expect(toQuery(calls[0]?.where)).toEqual({
      params: [updated.id, "current", 3],
      sql:
        '(("locked_record"."id" = $1) and ("locked_record"."name" = $2) and ("locked_record"."lock_version" = $3))',
    })
  })

  test("guards deletes at the initial lock version", async () => {
    const deleted: LockedRecord = {
      id: "01992a80-1d71-7f24-a150-f1177e3f6419",
      lockVersion: 0,
      name: "deleted",
    }
    const { calls, executor } = createExecutor([deleted])

    await expect(
      Effect.runPromise(
        deleteWithOptimisticLock({
          executor,
          table: lockedRecord,
          id: deleted.id,
          expectedLockVersion: 0,
        }),
      ),
    ).resolves.toEqual(deleted)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.operation).toBe("delete")
    expect(toQuery(calls[0]?.where)).toEqual({
      params: [deleted.id, 0],
      sql: '(("locked_record"."id" = $1) and ("locked_record"."lock_version" = $2))',
    })
  })

  test("raises a typed stale-object error when no row matches", async () => {
    const { executor } = createExecutor([])

    await expect(
      Effect.runPromise(
        updateWithOptimisticLock({
          executor,
          table: lockedRecord,
          id: "01992a80-1d71-7f24-a150-f1177e3f6419",
          expectedLockVersion: 2,
          set: { name: "stale" },
        }),
      ),
    ).rejects.toMatchObject(
      {
        expectedLockVersion: 2,
        name: "OptimisticLockError",
        reason: "conflict",
        tableName: "locked_record",
      } satisfies Partial<OptimisticLockError>,
    )
  })

  test("rejects a negative persisted lock version", async () => {
    const { executor } = createExecutor([{
      id: "01992a80-1d71-7f24-a150-f1177e3f6419",
      lockVersion: -1,
      name: "updated",
    }])

    await expect(
      Effect.runPromise(
        updateWithOptimisticLock({
          executor,
          table: lockedRecord,
          id: "01992a80-1d71-7f24-a150-f1177e3f6419",
          expectedLockVersion: 2,
          set: { name: "updated" },
        }),
      ),
    ).rejects.toMatchObject(
      {
        name: "OptimisticLockError",
        reason: "invalid-result",
        tableName: "locked_record",
      } satisfies Partial<OptimisticLockError>,
    )
  })
})

function createExecutor(rows: unknown[]) {
  const result = Effect.succeed(rows)
  const calls: MutationCall[] = []
  const executor = {
    delete: () => {
      const call: MutationCall = { operation: "delete" }
      calls.push(call)
      return {
        where: (where: SQL) => {
          call.where = where
          return { returning: () => result }
        },
      }
    },
    update: () => {
      const call: MutationCall = { operation: "update" }
      calls.push(call)
      return {
        set: (set: Record<string, unknown>) => {
          call.set = set
          return {
            where: (where: SQL) => {
              call.where = where
              return { returning: () => result }
            },
          }
        },
      }
    },
  } as unknown as Pick<EffectDatabase, "delete" | "update">

  return { calls, executor }
}

function toQuery(expression: SQL | undefined) {
  if (!expression) throw new Error("Expected a SQL expression")
  const query = new PgDialect().sqlToQuery(expression)
  return { params: query.params, sql: query.sql }
}
