import { eq, sql } from "drizzle-orm"
import { Duration, Effect, Option, Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"

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

import { db, runDatabaseEffect } from "@/db"
import { cacheEntry } from "@/db/schema.server"
import { deleteDatabaseCache, readDatabaseCache, writeDatabaseCache } from "./cache.server"

const cacheTestNamespace = "cache-integration"
const cacheTestOptions = {
  namespace: cacheTestNamespace,
  key: "key",
  schema: Schema.NullOr(Schema.String),
}

describe.skipIf(!cacheIntegration.url)("PostgreSQL cache", () => {
  afterEach(async () => {
    await db.delete(cacheEntry).where(sql`${cacheEntry.namespace} like 'cache-integration%'`)
  })

  test("enforces character limits in PostgreSQL and accepts Unicode at the boundary", async () => {
    const options = {
      ...cacheTestOptions,
      namespace: cacheTestNamespace + "😀".repeat(64 - cacheTestNamespace.length),
      key: "😀".repeat(512),
    }
    await runDatabaseEffect(writeDatabaseCache({ ...options, value: "boundary" }))
    expect(await runDatabaseEffect(readDatabaseCache(options))).toEqual(Option.some("boundary"))
    for (
      const identity of [
        { namespace: options.namespace + "x", key: "key" },
        { namespace: cacheTestNamespace, key: options.key + "x" },
      ]
    ) {
      await expect(db.insert(cacheEntry).values({ ...identity, value: '"invalid"' }))
        .rejects.toMatchObject({ cause: { code: "23514" } })
    }
  })

  test("preserves null, isolates namespaces, overwrites and deletes", async () => {
    await runDatabaseEffect(Effect.gen(function* () {
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
        yield* readDatabaseCache({ ...cacheTestOptions, namespace: `${cacheTestNamespace}-other` }),
      ).toEqual(Option.some("other"))
    }))
  })

  test("upserts value and TTL together while preserving row identity and creation time", async () => {
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "expired", timeToLive: Duration.zero }),
    )
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(Option.none())
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "finite", timeToLive: "1 hour" }),
    )
    const [finite] = await db.select().from(cacheEntry).where(
      eq(cacheEntry.namespace, cacheTestNamespace),
    )
    expect(finite?.expiresAt).toBeInstanceOf(Date)
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(
      Option.some("finite"),
    )
    await runDatabaseEffect(
      writeDatabaseCache({ ...cacheTestOptions, value: "extended", timeToLive: "2 hours" }),
    )
    const extendedRows = await db.select().from(cacheEntry).where(
      eq(cacheEntry.namespace, cacheTestNamespace),
    )
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
    const [unlimited] = await db.select().from(cacheEntry).where(
      eq(cacheEntry.namespace, cacheTestNamespace),
    )
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
    const expiredRows = await db.select().from(cacheEntry).where(
      eq(cacheEntry.namespace, cacheTestNamespace),
    )
    expect(expiredRows).toHaveLength(1)
    expect(expiredRows[0]!.id).toBe(finite!.id)
    expect(expiredRows[0]!.value).toBe('"expired again"')
    expect(expiredRows[0]!.expiresAt).toEqual(expiredRows[0]!.updatedAt)
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(Option.none())
  })

  test("propagates corrupt JSON and schema errors", async () => {
    for (const value of ["not-json", "42"]) {
      await db.insert(cacheEntry).values({ namespace: cacheTestNamespace, key: "key", value })
        .onConflictDoUpdate({ target: [cacheEntry.namespace, cacheEntry.key], set: { value } })
      const error = await runDatabaseEffect(readDatabaseCache(cacheTestOptions).pipe(Effect.flip))
      expect(error._tag).toBe("SchemaError")
    }
  })
})
