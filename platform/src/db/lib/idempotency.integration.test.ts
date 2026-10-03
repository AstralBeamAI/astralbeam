import { eq, inArray } from "drizzle-orm"
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { KeyValueStore } from "effect/persistence"
import { SqlClient, SqlError } from "effect/sql"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

const idempotencyIntegration = vi.hoisted(() => {
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

import { makeDatabaseCache } from "../cache.server.ts"
import { getAuthDatabase } from "../database.server.ts"
import { cacheEntry } from "../schema.server.ts"
import { runAppEffect } from "../../lib/runtime/app-effect.server.ts"
import {
  IdempotencyInProgress,
  IdempotencyParametersMismatch,
  withDatabaseIdempotency,
} from "./idempotency.server.ts"

const idempotencyTestNamespace = "idempotency"
const idempotencyTestParameters = {
  name: "created",
  settings: { nested: { a: 1, b: 2 }, labels: ["a", "b"] },
}
const idempotencyTestOperation = {
  name: "SyntheticWrite/v1",
  parameters: Schema.Struct({ name: Schema.String, settings: Schema.Json }),
  success: Schema.String,
  error: Schema.String,
}

class IdempotencyTestDeclined extends Schema.TaggedError<IdempotencyTestDeclined>()(
  "IdempotencyTestDeclined",
  { reason: Schema.String },
) {}

describe.skipIf(!idempotencyIntegration.url)("PostgreSQL idempotency", () => {
  let db: ReturnType<typeof getAuthDatabase>
  let effects: Effect.Success<ReturnType<typeof makeDatabaseCache<typeof Schema.String>>>

  beforeAll(async () => {
    db = getAuthDatabase()
    effects = await runAppEffect(
      makeDatabaseCache({
        namespace: `${idempotencyTestNamespace}-effects`,
        schema: Schema.String,
      }),
    )
  })

  afterEach(async () => {
    await db
      .delete(cacheEntry)
      .where(
        inArray(cacheEntry.namespace, [
          idempotencyTestNamespace,
          idempotencyTestNamespace + "-effects",
          idempotencyTestNamespace + "-other",
        ]),
      )
  })

  function idempotencyTestRequest(
    key: string,
    input: unknown = idempotencyTestParameters,
    scope = "organization-1",
  ) {
    return {
      scope,
      key,
      operation: idempotencyTestOperation,
      parameters: input,
    }
  }

  const idempotencyTestSize = Effect.tryPromise(() =>
    db.$count(cacheEntry, eq(cacheEntry.namespace, idempotencyTestNamespace)),
  )

  const idempotencyTestExecute = (input: typeof idempotencyTestOperation.parameters.Type) =>
    effects.set(crypto.randomUUID(), input.name).pipe(Effect.as(input.name), Effect.orDie)

  test("replays completed writes without extending retention and executes again after expiry", async () => {
    const request = idempotencyTestRequest(
      "🔑".repeat(255),
      structuredClone(idempotencyTestParameters),
    )
    await runAppEffect(
      withDatabaseIdempotency(request, (input) =>
        idempotencyTestExecute(input).pipe(
          Effect.tap(() =>
            Effect.sync(() => Object.assign(input.settings!, { labels: ["changed"] })),
          ),
        ),
      ),
    )
    const [first] = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, idempotencyTestNamespace))
    expect(
      await runAppEffect(
        withDatabaseIdempotency(idempotencyTestRequest(request.key), idempotencyTestExecute),
      ),
    ).toBe("created")
    const [replayed] = await db
      .select()
      .from(cacheEntry)
      .where(eq(cacheEntry.namespace, idempotencyTestNamespace))
    expect(await runAppEffect(effects.size)).toBe(1)
    expect(first?.expiresAt).toBeInstanceOf(Date)
    expect(replayed?.expiresAt).toEqual(first?.expiresAt)

    await db
      .update(cacheEntry)
      .set({ expiresAt: new Date(0) })
      .where(eq(cacheEntry.namespace, idempotencyTestNamespace))
    expect(
      await runAppEffect(
        withDatabaseIdempotency(
          idempotencyTestRequest(request.key, { ...idempotencyTestParameters, name: "new" }),
          idempotencyTestExecute,
        ),
      ),
    ).toBe("new")
    expect(await runAppEffect(effects.size)).toBe(2)
  })

  test("commits a typed failure for replay while rolling back its business writes", async () => {
    const write = vi.fn((input: typeof idempotencyTestOperation.parameters.Type) =>
      idempotencyTestExecute(input).pipe(
        Effect.andThen(Effect.fail(new IdempotencyTestDeclined({ reason: "declined" }))),
      ),
    )
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await runAppEffect(
        withDatabaseIdempotency(
          {
            ...idempotencyTestRequest("failure"),
            operation: { ...idempotencyTestOperation, error: IdempotencyTestDeclined },
          },
          write,
        ).pipe(Effect.flip),
      )
      expect(error).toBeInstanceOf(IdempotencyTestDeclined)
      expect(error).toMatchObject({ reason: "declined" })
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(await runAppEffect(effects.size)).toBe(0)
  })

  test("ignores nested property order but rejects changed parameters or operations", async () => {
    await runAppEffect(
      withDatabaseIdempotency(idempotencyTestRequest("mismatch"), idempotencyTestExecute),
    )
    await runAppEffect(
      withDatabaseIdempotency(
        idempotencyTestRequest("mismatch", {
          settings: { labels: ["a", "b"], nested: { b: 2, a: 1 } },
          name: "created",
        }),
        () => Effect.die("Must not execute"),
      ),
    )
    for (const settings of [
      { nested: { a: 1, b: 3 }, labels: ["a", "b"] },
      { nested: { a: 1, b: 2 }, labels: ["b", "a"] },
    ]) {
      const error = await runAppEffect(
        withDatabaseIdempotency(
          idempotencyTestRequest("mismatch", { ...idempotencyTestParameters, settings }),
          () => Effect.die("Must not execute"),
        ).pipe(Effect.flip),
      )
      expect(error).toBeInstanceOf(IdempotencyParametersMismatch)
    }
    const error = await runAppEffect(
      withDatabaseIdempotency(
        {
          ...idempotencyTestRequest("mismatch"),
          operation: { ...idempotencyTestOperation, name: "OtherWrite/v1", success: Schema.Number },
        },
        () => Effect.succeed(42),
      ).pipe(Effect.flip),
    )
    expect(error).toBeInstanceOf(IdempotencyParametersMismatch)
  })

  test("isolates identical client keys by caller scope and namespace", async () => {
    for (const { scope, namespace, name } of [
      { scope: "organization-1", namespace: idempotencyTestNamespace, name: "created" },
      { scope: "organization-2", namespace: idempotencyTestNamespace, name: "other" },
      { scope: "organization-1", namespace: idempotencyTestNamespace + "-other", name: "separate" },
    ]) {
      const request = {
        ...idempotencyTestRequest("scoped", { ...idempotencyTestParameters, name }, scope),
        namespace,
      }
      expect(await runAppEffect(withDatabaseIdempotency(request, idempotencyTestExecute))).toBe(
        name,
      )
    }
    expect(await runAppEffect(effects.size)).toBe(3)
  })

  test("returns in-progress without executing a concurrent duplicate", async () => {
    await runAppEffect(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const first = yield* Effect.forkChild(
          withDatabaseIdempotency(idempotencyTestRequest("concurrent"), (input) =>
            idempotencyTestExecute(input).pipe(
              Effect.tap(() => Deferred.succeed(started, undefined)),
              Effect.tap(() => Deferred.await(release)),
            ),
          ),
        )
        yield* Deferred.await(started)
        const error = yield* withDatabaseIdempotency(
          idempotencyTestRequest("concurrent"),
          idempotencyTestExecute,
        ).pipe(Effect.flip)
        expect(error).toBeInstanceOf(IdempotencyInProgress)
        expect(
          yield* withDatabaseIdempotency(
            idempotencyTestRequest("other-key"),
            idempotencyTestExecute,
          ),
        ).toBe("created")
        yield* Deferred.succeed(release, undefined)
        expect(yield* Fiber.join(first)).toBe("created")
      }),
    )
    expect(await runAppEffect(effects.size)).toBe(2)
  })

  test("leaves a declared failure uncached when cleanup also defects", async () => {
    const exit = await runAppEffect(
      withDatabaseIdempotency(idempotencyTestRequest("defect"), (input) =>
        idempotencyTestExecute(input).pipe(
          Effect.andThen(Effect.fail("declined")),
          Effect.ensuring(Effect.die("cleanup failed")),
        ),
      ).pipe(Effect.exit),
    )
    expect(Exit.hasDies(exit)).toBe(true)
    expect(await runAppEffect(effects.size)).toBe(0)
    expect(await runAppEffect(idempotencyTestSize)).toBe(0)
  })

  test("rolls back interruption and releases the execution lock", async () => {
    await runAppEffect(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const first = yield* Effect.forkChild(
          withDatabaseIdempotency(idempotencyTestRequest("interrupt"), (input) =>
            idempotencyTestExecute(input).pipe(
              Effect.tap(() => Deferred.succeed(started, undefined)),
              Effect.andThen(Effect.never),
            ),
          ),
        )
        yield* Deferred.await(started)
        yield* Fiber.interrupt(first)
        expect(Exit.hasInterrupts(yield* Fiber.await(first))).toBe(true)
        expect(yield* effects.size).toBe(0)
        expect(yield* idempotencyTestSize).toBe(0)
        expect(
          yield* withDatabaseIdempotency(
            idempotencyTestRequest("interrupt"),
            idempotencyTestExecute,
          ),
        ).toBe("created")
      }),
    )
  })

  test("rolls back a successful business write if recording its outcome fails", async () => {
    const error = await runAppEffect(
      withDatabaseIdempotency(idempotencyTestRequest("storage"), (input) =>
        Effect.gen(function* () {
          yield* idempotencyTestExecute(input)
          const client = yield* SqlClient.SqlClient
          yield* client`alter table cache_entry add constraint idempotency_test_reject_record
            check (namespace <> 'idempotency') not valid`.pipe(Effect.orDie)
          return input.name
        }),
      ).pipe(Effect.flip),
    )
    expect(error).toBeInstanceOf(KeyValueStore.KeyValueStoreError)
    expect(await runAppEffect(effects.size)).toBe(0)
    expect(await runAppEffect(idempotencyTestSize)).toBe(0)
  })

  test("leaves SQL failures uncached even alongside a declared failure", async () => {
    const request = {
      ...idempotencyTestRequest("sql-failure"),
      operation: {
        ...idempotencyTestOperation,
        error: Schema.Union([Schema.String, SqlError.SqlError]),
      },
    }
    const error = await runAppEffect(
      withDatabaseIdempotency(request, (input) =>
        Effect.gen(function* () {
          yield* idempotencyTestExecute(input)
          const client = yield* SqlClient.SqlClient
          yield* client`select 1 / 0`.pipe(
            Effect.catchCause((cause) =>
              Effect.failCause(Cause.combine(Cause.fail("declined"), cause)),
            ),
          )
          return input.name
        }),
      ).pipe(Effect.flip),
    )
    expect(error).toBe("declined")
    expect(await runAppEffect(effects.size)).toBe(0)
    expect(await runAppEffect(idempotencyTestSize)).toBe(0)
  })

  test("rejects an ambient transaction before executing the write", async () => {
    const write = vi.fn(idempotencyTestExecute)
    const exit = await runAppEffect(
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient
        return yield* client.withTransaction(
          withDatabaseIdempotency(idempotencyTestRequest("ambient"), write),
        )
      }).pipe(Effect.exit),
    )
    expect(Exit.hasDies(exit)).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })
})
