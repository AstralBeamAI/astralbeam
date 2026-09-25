import { eq, sql } from "drizzle-orm"
import { Duration, Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { beforeAll, afterEach, describe, expect, test, vi } from "vitest"

const cacheIntegration = vi.hoisted(() => {
  const configured = globalThis.process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test")) {
      throw new Error("Use a disposable loopback database ending in _test")
    }
  }
  return { url }
})

import { getAuthDatabase, runDatabaseEffect } from "@/db"
import { cacheEntry } from "@/db/schema.server"
import expiredCacheCleanup from "../workflows/expired-cache-cleanup.ts"
import {
  deleteDatabaseCache,
  deleteExpiredDatabaseCacheBatch,
  readDatabaseCache,
  withDatabaseCacheLock,
  writeDatabaseCache,
} from "./cache.server"

const cacheTestNamespace = "cache-integration"
const cacheTestOptions = {
  namespace: cacheTestNamespace,
  key: "key",
  schema: Schema.NullOr(Schema.String),
}

describe.skipIf(!cacheIntegration.url)("PostgreSQL cache", () => {
  let db: ReturnType<typeof getAuthDatabase>
  beforeAll(() => {
    db = getAuthDatabase()
  })
  afterEach(async () => {
    await db.delete(cacheEntry).where(sql`${cacheEntry.namespace} like 'cache-integration%'`)
  })

  test("cleanup drains multiple bounded batches and preserves refreshed and non-expiring entries", async () => {
    await db.insert(cacheEntry).values(
      Array.from({ length: 2001 }, (_, index) => ({
        namespace: cacheTestNamespace,
        key: `expired-${index}`,
        value: '"old"',
        expiresAt: new Date(0),
      })),
    )
    await runDatabaseEffect(writeDatabaseCache({ ...cacheTestOptions, value: "keep" }))
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, key: "refreshed", value: "old", timeToLive: 0 }),
    )
    await runDatabaseEffect(
      writeDatabaseCache({
        ...cacheTestOptions,
        key: "refreshed",
        value: "new",
        timeToLive: "1 hour",
      }),
    )
    expect(await runDatabaseEffect(deleteExpiredDatabaseCacheBatch)).toBe(1000)
    await runDatabaseEffect(expiredCacheCleanup)
    expect(await runDatabaseEffect(deleteExpiredDatabaseCacheBatch)).toBe(0)
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(
      Option.some("keep"),
    )
    expect(
      await runDatabaseEffect(readDatabaseCache({ ...cacheTestOptions, key: "refreshed" })),
    ).toEqual(Option.some("new"))
  })

  test("cleanup skips a row while another transaction refreshes its TTL", async () => {
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "old", timeToLive: 0 }),
    )
    await db.transaction(async (transaction) => {
      await transaction
        .update(cacheEntry)
        .set({ expiresAt: sql`now() + interval '1 hour'` })
        .where(eq(cacheEntry.namespace, cacheTestNamespace))
      expect(await runDatabaseEffect(deleteExpiredDatabaseCacheBatch)).toBe(0)
    })
    expect(await runDatabaseEffect(deleteExpiredDatabaseCacheBatch)).toBe(0)
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(Option.some("old"))
  })

  test("enforces character limits in PostgreSQL and accepts Unicode at the boundary", async () => {
    const options = {
      ...cacheTestOptions,
      namespace: cacheTestNamespace + "😀".repeat(64 - cacheTestNamespace.length),
      key: "😀".repeat(512),
    }
    await runDatabaseEffect(writeDatabaseCache({ ...options, value: "boundary" }))
    expect(await runDatabaseEffect(readDatabaseCache(options))).toEqual(Option.some("boundary"))
    for (const identity of [
      { namespace: options.namespace + "x", key: "key" },
      { namespace: cacheTestNamespace, key: options.key + "x" },
    ]) {
      await expect(
        db.insert(cacheEntry).values({ ...identity, value: '"invalid"' }),
      ).rejects.toMatchObject({ cause: { code: "23514" } })
    }
  })

  test("preserves null, isolates namespaces, overwrites and deletes", async () => {
    await runDatabaseEffect(
      Effect.gen(function* () {
        expect(yield* readDatabaseCache(cacheTestOptions)).toEqual(Option.none())
        yield* writeDatabaseCache({ ...cacheTestOptions, value: null })
        expect(yield* readDatabaseCache(cacheTestOptions)).toEqual(Option.some(null))
        yield* writeDatabaseCache({
          ...cacheTestOptions,
          namespace: `${cacheTestNamespace}-other`,
          value: "other",
        })
        yield* writeDatabaseCache({ ...cacheTestOptions, value: "updated" })
        expect(yield* readDatabaseCache(cacheTestOptions)).toEqual(Option.some("updated"))
        yield* deleteDatabaseCache(cacheTestOptions)
        expect(yield* readDatabaseCache(cacheTestOptions)).toEqual(Option.none())
        expect(
          yield* readDatabaseCache({
            ...cacheTestOptions,
            namespace: `${cacheTestNamespace}-other`,
          }),
        ).toEqual(Option.some("other"))
      }),
    )
  })

  test("upserts value and TTL together while preserving row identity and creation time", async () => {
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "expired", timeToLive: Duration.zero }),
    )
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(Option.none())
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "finite", timeToLive: "1 hour" }),
    )
    const [finite] = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, cacheTestNamespace))
    expect(finite?.expiresAt).toBeInstanceOf(Date)
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(
      Option.some("finite"),
    )
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "extended", timeToLive: "2 hours" }),
    )
    const extendedRows = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, cacheTestNamespace))
    expect(extendedRows).toHaveLength(1)
    const extended = extendedRows[0]!
    expect(extended.id).toBe(finite!.id)
    expect(extended.createdAt).toEqual(finite!.createdAt)
    expect(extended.updatedAt.getTime()).toBeGreaterThanOrEqual(finite!.updatedAt.getTime())
    expect(extended.expiresAt!.getTime()).toBeGreaterThan(finite!.expiresAt!.getTime())
    expect(extended.expiresAt!.getTime() - extended.updatedAt.getTime()).toBe(7_200_000)
    expect(extended.value).toBe('"extended"')
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(
      Option.some("extended"),
    )
    await runDatabaseEffect(writeDatabaseCache({ ...cacheTestOptions, value: "forever" }))
    const [unlimited] = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, cacheTestNamespace))
    expect(unlimited?.expiresAt).toBeNull()
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(
      Option.some("forever"),
    )
    await runDatabaseEffect(
      writeDatabaseCache({
        ...cacheTestOptions,
        value: "expired again",
        timeToLive: Duration.zero,
      }),
    )
    const expiredRows = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, cacheTestNamespace))
    expect(expiredRows).toHaveLength(1)
    expect(expiredRows[0]!.id).toBe(finite!.id)
    expect(expiredRows[0]!.value).toBe('"expired again"')
    expect(expiredRows[0]!.expiresAt).toEqual(expiredRows[0]!.updatedAt)
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(Option.none())
  })

  test("propagates corrupt JSON and schema errors", async () => {
    for (const value of ["not-json", "42"]) {
      await db
        .insert(cacheEntry)
        .values({ namespace: cacheTestNamespace, key: "key", value })
        .onConflictDoUpdate({ target: [cacheEntry.namespace, cacheEntry.key], set: { value } })
      const error = await runDatabaseEffect(readDatabaseCache(cacheTestOptions).pipe(Effect.flip))
      expect(error._tag).toBe("SchemaError")
    }
  })

  test("serializes read-modify-write of an absent key and joins an enclosing transaction", async () => {
    const counter = { ...cacheTestOptions, schema: Schema.Number }
    await Promise.all(
      Array.from({ length: 10 }, () =>
        runDatabaseEffect(
          withDatabaseCacheLock(
            counter,
            Effect.gen(function* () {
              const current = yield* readDatabaseCache(counter)
              yield* writeDatabaseCache({
                ...counter,
                value: Option.getOrElse(current, () => 0) + 1,
              })
            }),
          ),
        ),
      ),
    )
    expect(await runDatabaseEffect(readDatabaseCache(counter))).toEqual(Option.some(10))
    const result = await runDatabaseEffect(
      Effect.result(
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient
          return yield* client.withTransaction(
            withDatabaseCacheLock(counter, writeDatabaseCache({ ...counter, value: 99 })).pipe(
              Effect.andThen(Effect.fail("rollback")),
            ),
          )
        }),
      ),
    )
    expect(result).toMatchObject({ _tag: "Failure", failure: "rollback" })
    expect(await runDatabaseEffect(readDatabaseCache(counter))).toEqual(Option.some(10))
    await runDatabaseEffect(deleteDatabaseCache(counter))
    expect(await runDatabaseEffect(readDatabaseCache(counter))).toEqual(Option.none())
  })
})
