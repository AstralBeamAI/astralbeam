import { and, eq, sql } from "drizzle-orm"
import { Duration, Effect, Exit, Fiber, Latch, Option, Schema } from "effect"
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
import {
  deleteDatabaseCache,
  makeDatabaseCacheLookup,
  pruneDatabaseCache,
  readDatabaseCache,
  writeDatabaseCache,
} from "./cache.server"

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

  test("expires on the database clock and resets expiry on overwrite", async () => {
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
    await runDatabaseEffect(writeDatabaseCache({ ...cacheTestOptions, value: "forever" }))
    const [unlimited] = await db.select().from(cacheEntry).where(
      eq(cacheEntry.namespace, cacheTestNamespace),
    )
    expect(unlimited?.expiresAt).toBeNull()
    expect(await runDatabaseEffect(readDatabaseCache(cacheTestOptions))).toEqual(
      Option.some("forever"),
    )
  })

  test("reuses persisted data across instances and observes writes and deletes", async () => {
    let calls = 0
    await runDatabaseEffect(Effect.gen(function* () {
      const options = { ...cacheTestOptions, lookup: () => Effect.sync(() => `load-${++calls}`) }
      const first = yield* makeDatabaseCacheLookup(options)
      const second = yield* makeDatabaseCacheLookup(options)
      expect(yield* first("key")).toBe("load-1")
      expect(yield* second("key")).toBe("load-1")
      yield* writeDatabaseCache({ ...cacheTestOptions, value: "external" })
      expect(yield* first("key")).toBe("external")
      yield* deleteDatabaseCache(cacheTestOptions)
      expect(yield* first("key")).toBe("load-2")
    }))
  })

  test("shares pending work and canceling one waiter preserves another", async () => {
    let calls = 0
    await runDatabaseEffect(Effect.gen(function* () {
      const started = yield* Latch.make()
      const complete = yield* Latch.make()
      const lookup = yield* makeDatabaseCacheLookup({
        ...cacheTestOptions,
        lookup: (key) =>
          Effect.gen(function* () {
            calls++
            if (key === "independent") return key
            yield* started.open
            yield* complete.await
            return "shared"
          }),
      })
      const first = yield* lookup("key").pipe(Effect.forkChild({ startImmediately: true }))
      yield* started.await
      const second = yield* lookup("key").pipe(Effect.forkChild({ startImmediately: true }))
      expect(yield* lookup("independent")).toBe("independent")
      yield* Fiber.interrupt(first)
      yield* complete.open
      expect(yield* Fiber.join(second)).toBe("shared")
      expect(calls).toBe(2)
    }))
  })

  test("interrupts abandoned work and retries it", async () => {
    let calls = 0
    await runDatabaseEffect(Effect.gen(function* () {
      const started = yield* Latch.make()
      const interrupted = yield* Latch.make()
      const lookup = yield* makeDatabaseCacheLookup({
        ...cacheTestOptions,
        lookup: () =>
          Effect.suspend(() =>
            ++calls > 1 ? Effect.succeed("retried") : started.open.pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => interrupted.open),
            )
          ),
      })
      const waiter = yield* lookup("key").pipe(Effect.forkChild({ startImmediately: true }))
      yield* started.await
      yield* Fiber.interrupt(waiter)
      yield* interrupted.await
      expect(yield* lookup("key")).toBe("retried")
    }))
  })

  test("does not retain failed or synchronously interrupted loads", async () => {
    for (const failure of [Effect.fail("lookup failure"), Effect.interrupt]) {
      let calls = 0
      await runDatabaseEffect(Effect.gen(function* () {
        yield* deleteDatabaseCache(cacheTestOptions)
        const lookup = yield* makeDatabaseCacheLookup({
          ...cacheTestOptions,
          lookup: () => Effect.suspend(() => ++calls > 1 ? Effect.succeed("retried") : failure),
        })
        expect(Exit.isFailure(yield* Effect.exit(lookup("key")))).toBe(true)
        expect(yield* readDatabaseCache(cacheTestOptions)).toEqual(Option.none())
        expect(yield* lookup("key")).toBe("retried")
        expect(calls).toBe(2)
      }))
    }
  })

  test("propagates corrupt JSON and schema errors without invoking the loader", async () => {
    const loader = vi.fn(() => Effect.succeed("loaded"))
    for (const value of ["not-json", "42"]) {
      await db.insert(cacheEntry).values({ namespace: cacheTestNamespace, key: "key", value })
        .onConflictDoUpdate({ target: [cacheEntry.namespace, cacheEntry.key], set: { value } })
      const error = await runDatabaseEffect(Effect.gen(function* () {
        const lookup = yield* makeDatabaseCacheLookup({ ...cacheTestOptions, lookup: loader })
        return yield* lookup("key").pipe(Effect.flip)
      }))
      expect(error._tag).toBe("SchemaError")
    }
    expect(loader).not.toHaveBeenCalled()
  })

  test("prunes at most 1000 expired rows and skips locked renewals", async () => {
    await db.insert(cacheEntry).values(Array.from({ length: 1002 }, (_, key) => ({
      namespace: cacheTestNamespace,
      key: String(key),
      value: '"expired"',
      expiresAt: new Date(0),
    })))
    await db.transaction(async (transaction) => {
      await transaction.update(cacheEntry).set({ expiresAt: null }).where(and(
        eq(cacheEntry.namespace, cacheTestNamespace),
        eq(cacheEntry.key, "0"),
      ))
      expect(await runDatabaseEffect(pruneDatabaseCache())).toBe(1000)
    })
    expect(await runDatabaseEffect(pruneDatabaseCache())).toBe(1)
    expect(await runDatabaseEffect(readDatabaseCache({ ...cacheTestOptions, key: "0" }))).toEqual(
      Option.some("expired"),
    )
  })
})
