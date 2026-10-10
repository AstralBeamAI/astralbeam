import { eq, sql } from "drizzle-orm"
import { Duration, Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
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

import { getAuthDatabase } from "@/db/database.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { cacheEntry } from "@/db/schema.server"
import expiredCacheCleanup from "../lib/workflows/expired-cache-cleanup.server.ts"
import {
  deleteExpiredDatabaseCacheBatch,
  makeDatabaseCache,
  tryWithDatabaseCacheLock,
  withDatabaseCacheLock,
} from "./cache.server"

type CacheTestIdentity<S extends Schema.Constraint> = {
  readonly namespace: string
  readonly key: string
  readonly schema: S
}

function readTestCache<S extends Schema.Constraint>(options: CacheTestIdentity<S>) {
  return Effect.flatMap(makeDatabaseCache(options), (cache) => cache.get(options.key))
}

function writeTestCache<S extends Schema.Constraint>(
  options: CacheTestIdentity<S> & {
    readonly value: S["Type"]
    readonly timeToLive?: Duration.Input
  },
) {
  return Effect.flatMap(makeDatabaseCache(options), (cache) =>
    cache.set(options.key, options.value),
  )
}

function deleteTestCache<S extends Schema.Constraint>(options: CacheTestIdentity<S>) {
  return Effect.flatMap(makeDatabaseCache(options), (cache) => cache.remove(options.key))
}

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
    await runAppEffect(writeTestCache({ ...cacheTestOptions, value: "keep" }))
    await runAppEffect(
      writeTestCache({ ...cacheTestOptions, key: "refreshed", value: "old", timeToLive: 0 }),
    )
    await runAppEffect(
      writeTestCache({
        ...cacheTestOptions,
        key: "refreshed",
        value: "new",
        timeToLive: "1 hour",
      }),
    )
    expect(await runAppEffect(deleteExpiredDatabaseCacheBatch)).toBe(1000)
    await runAppEffect(expiredCacheCleanup)
    expect(await runAppEffect(deleteExpiredDatabaseCacheBatch)).toBe(0)
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.some("keep"))
    expect(await runAppEffect(readTestCache({ ...cacheTestOptions, key: "refreshed" }))).toEqual(
      Option.some("new"),
    )
  })

  test("cleanup skips a row while another transaction refreshes its TTL", async () => {
    await runAppEffect(writeTestCache({ ...cacheTestOptions, value: "old", timeToLive: 0 }))
    const refreshed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const updating = db.transaction(async (transaction) => {
      await transaction
        .update(cacheEntry)
        .set({ expiresAt: sql`now() + interval '1 hour'` })
        .where(eq(cacheEntry.namespace, cacheTestNamespace))
      refreshed.resolve()
      await release.promise
    })
    await refreshed.promise
    try {
      expect(await runAppEffect(deleteExpiredDatabaseCacheBatch)).toBe(0)
    } finally {
      release.resolve()
      await updating
    }
    expect(await runAppEffect(deleteExpiredDatabaseCacheBatch)).toBe(0)
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.some("old"))
  })

  test("enforces character limits in PostgreSQL and accepts Unicode at the boundary", async () => {
    const options = {
      ...cacheTestOptions,
      namespace: cacheTestNamespace + "😀".repeat(64 - cacheTestNamespace.length),
      key: "😀".repeat(512),
    }
    await runAppEffect(writeTestCache({ ...options, value: "boundary" }))
    expect(await runAppEffect(readTestCache(options))).toEqual(Option.some("boundary"))
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
    await runAppEffect(
      Effect.gen(function* () {
        expect(yield* readTestCache(cacheTestOptions)).toEqual(Option.none())
        yield* writeTestCache({ ...cacheTestOptions, value: null })
        expect(yield* readTestCache(cacheTestOptions)).toEqual(Option.some(null))
        yield* writeTestCache({
          ...cacheTestOptions,
          namespace: `${cacheTestNamespace}-other`,
          value: "other",
        })
        yield* writeTestCache({ ...cacheTestOptions, value: "updated" })
        expect(yield* readTestCache(cacheTestOptions)).toEqual(Option.some("updated"))
        yield* deleteTestCache(cacheTestOptions)
        expect(yield* readTestCache(cacheTestOptions)).toEqual(Option.none())
        expect(
          yield* readTestCache({
            ...cacheTestOptions,
            namespace: `${cacheTestNamespace}-other`,
          }),
        ).toEqual(Option.some("other"))
      }),
    )
  })

  test("upserts value and TTL together while preserving row identity and creation time", async () => {
    await runAppEffect(
      writeTestCache({ ...cacheTestOptions, value: "expired", timeToLive: Duration.zero }),
    )
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.none())
    await runAppEffect(
      writeTestCache({ ...cacheTestOptions, value: "finite", timeToLive: "1 hour" }),
    )
    const [finite] = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, cacheTestNamespace))
    expect(finite?.expiresAt).toBeInstanceOf(Date)
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.some("finite"))
    await runAppEffect(
      writeTestCache({ ...cacheTestOptions, value: "extended", timeToLive: "2 hours" }),
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
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.some("extended"))
    await runAppEffect(writeTestCache({ ...cacheTestOptions, value: "forever" }))
    const [unlimited] = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, cacheTestNamespace))
    expect(unlimited?.expiresAt).toBeNull()
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.some("forever"))
    await runAppEffect(
      writeTestCache({
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
    expect(await runAppEffect(readTestCache(cacheTestOptions))).toEqual(Option.none())
  })

  test("propagates corrupt JSON and schema errors", async () => {
    for (const value of ["not-json", "42"]) {
      await db
        .insert(cacheEntry)
        .values({ namespace: cacheTestNamespace, key: "key", value })
        .onConflictDoUpdate({ target: [cacheEntry.namespace, cacheEntry.key], set: { value } })
      const error = await runAppEffect(readTestCache(cacheTestOptions).pipe(Effect.flip))
      expect(error._tag).toBe("SchemaError")
    }
  })

  test("serializes read-modify-write of an absent key and joins an enclosing transaction", async () => {
    const counter = { ...cacheTestOptions, schema: Schema.Number }
    await Promise.all(
      Array.from({ length: 10 }, () =>
        runAppEffect(
          withDatabaseCacheLock(
            counter,
            Effect.gen(function* () {
              const current = yield* readTestCache(counter)
              yield* writeTestCache({
                ...counter,
                value: Option.getOrElse(current, () => 0) + 1,
              })
            }),
          ),
        ),
      ),
    )
    expect(await runAppEffect(readTestCache(counter))).toEqual(Option.some(10))
    const locked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const transaction = runAppEffect(
      Effect.result(
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient
          return yield* client.withTransaction(
            withDatabaseCacheLock(counter, writeTestCache({ ...counter, value: 99 })).pipe(
              Effect.tap(() =>
                Effect.promise(async () => {
                  locked.resolve()
                  await release.promise
                }),
              ),
              Effect.andThen(Effect.fail("rollback")),
            ),
          )
        }),
      ),
    )
    await locked.promise
    try {
      expect(
        await runAppEffect(tryWithDatabaseCacheLock(counter, Effect.die("Must not run"))),
      ).toEqual(Option.none())
    } finally {
      release.resolve()
    }
    expect(await transaction).toMatchObject({ _tag: "Failure", failure: "rollback" })
    expect(await runAppEffect(tryWithDatabaseCacheLock(counter, Effect.succeed(null)))).toEqual(
      Option.some(null),
    )
    expect(await runAppEffect(readTestCache(counter))).toEqual(Option.some(10))
    await runAppEffect(deleteTestCache(counter))
    expect(await runAppEffect(readTestCache(counter))).toEqual(Option.none())
  })
})
