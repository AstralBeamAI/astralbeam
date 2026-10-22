import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer, Scope, Exit, Context } from "effect"
import { beforeEach, describe, expect, test } from "vitest"
import { TestClock } from "effect/testing"

import { Database, getAuthDatabase } from "@/db/database"
import { organization } from "@/db/schema/organizations"
import { sandboxResource } from "@/db/schema/sandboxes"
import { SandboxProviderFactory } from "./factory.server"
import { SandboxResources } from "./resources.server"

const url = process.env.DATABASE_URL
const enabled = !!url && url !== "postgres://test:test@127.0.0.1:5432/test"
if (
  enabled &&
  (new URL(url).hostname !== "127.0.0.1" || !new URL(url).pathname.endsWith("_test"))
) {
  throw new Error("Use a disposable loopback database ending in _test")
}
const remote = new Set<string>()
let failDelete = false
let createGate: Promise<void> | undefined
let created: (() => void) | undefined
let createFailure: Error | undefined
let rejectedBeforeCreation = false
const adapter = {
  name: "daytona",
  capabilities: () => ({}),
  create: async ({ id }: { id: string }) => {
    expect(
      await getAuthDatabase()
        .select()
        .from(sandboxResource)
        .where(eq(sandboxResource.providerSandboxId, id)),
    ).toHaveLength(1)
    remote.add(id)
    created?.()
    await createGate
    if (createFailure) throw createFailure
    return { id, provider: "daytona" } as SandboxHandle
  },
  resume: ({ id }: { id: string }) =>
    rejectedBeforeCreation && createFailure
      ? Promise.reject(createFailure)
      : Promise.resolve(remote.has(id) ? ({ id } as SandboxHandle) : null),
  destroy: ({ id }: { id: string }) => {
    if (rejectedBeforeCreation && createFailure) return Promise.reject(createFailure)
    if (failDelete) return Promise.reject(new Error("provider offline"))
    remote.delete(id)
    return Promise.resolve()
  },
} as unknown as SandboxProvider
const layer = SandboxResources.layerNoDeps.pipe(
  Layer.provide([
    Database.layer,
    Layer.succeed(SandboxProviderFactory, { create: () => Effect.succeed(adapter) }),
  ]),
)
const run = <A, E>(effect: Effect.Effect<A, E, SandboxResources>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe.skipIf(!enabled)("durable sandbox ownership", () => {
  const db = getAuthDatabase()
  let organizationId: string
  const input = () => ({
    organizationId,
    provider: "daytona" as const,
    options: { target: "us", snapshot: "test" },
    credentials: { apiKey: "original-credential" },
  })
  beforeEach(async () => {
    await db.execute(sql`truncate organization cascade`)
    const [row] = await db
      .insert(organization)
      .values({ name: "Sandbox recovery", slug: "sandbox-recovery" })
      .returning()
    organizationId = row!.id
    remote.clear()
    failDelete = false
    createGate = undefined
    created = undefined
    createFailure = undefined
    rejectedBeforeCreation = false
  })

  test("another owner retries cleanup after expiry and cannot revive a retiring workspace", async () => {
    const id = await run(
      Effect.gen(function* () {
        const resources = yield* SandboxResources
        const provider = yield* resources.provider(input())
        const handle = yield* Effect.promise(() => provider.create({}))
        yield* resources.touch(organizationId, handle.id)
        yield* resources.reap()
        expect(remote.has(handle.id)).toBe(true)
        failDelete = true
        yield* Effect.tryPromise(() => handle.destroy()).pipe(Effect.exit)
        expect((yield* Effect.flip(resources.touch(organizationId, handle.id)))._tag).toBe(
          "SandboxResourceUnavailable",
        )
        return handle.id
      }),
    )
    const stored = (
      await db.execute<{ stored: string }>(
        sql`select configuration as stored from sandbox_resource`,
      )
    ).rows
    expect(stored[0]!.stored).not.toContain("original-credential")
    await db.update(sandboxResource).set({ expiresAt: sql`now() - interval '1 minute'` })
    failDelete = true
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(remote.has(id)).toBe(true)
    expect((await db.select().from(sandboxResource))[0]?.retiredAt).toBeInstanceOf(Date)
    await expect(
      run(Effect.flatMap(SandboxResources, (resources) => resources.touch(organizationId, id))),
    ).rejects.toThrow()
    failDelete = false
    await db.update(sandboxResource).set({ expiresAt: sql`now() - interval '1 minute'` })
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(remote.size).toBe(0)
    expect(await db.select().from(sandboxResource)).toEqual([])
  })

  test("retains an uncertain creation intent and cleans a late result after ownership is lost", async () => {
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    createGate = gate.promise
    created = started.resolve
    const scope = Effect.runSync(Scope.make())
    const context = await Effect.runPromise(Layer.buildWithScope(layer, scope))
    const resources = Context.get(context, SandboxResources)
    const provider = await Effect.runPromise(resources.provider(input()))
    const pending = provider.create({}).then(
      () => true,
      () => false,
    )
    try {
      await started.promise
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.update(sandboxResource).set({ expiresAt: sql`now() - interval '1 minute'` })
      await run(Effect.flatMap(SandboxResources, (nextOwner) => nextOwner.reap()))
      expect(remote.size).toBe(0)
      const rows = await db.select().from(sandboxResource)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.settled).toBe(false)
      expect(rows[0]?.retiredAt).toBeInstanceOf(Date)
      gate.resolve()
      expect(await pending).toBe(false)
      expect(await db.select().from(sandboxResource)).toEqual([])
    } finally {
      gate.resolve()
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await pending
    }
  })

  test("does not renew an orphan when saving its creation outcome fails", async () => {
    await db.execute(sql`create function fail_sandbox_settlement() returns trigger language plpgsql as $$
      begin if new.settled then raise exception 'injected settlement failure'; end if; return new; end $$`)
    await db.execute(sql`create trigger fail_sandbox_settlement before update on sandbox_resource
      for each row execute function fail_sandbox_settlement()`)
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const resources = yield* SandboxResources
          const provider = yield* resources.provider(input())
          yield* Effect.tryPromise(() => provider.create({})).pipe(Effect.flip)
          yield* Effect.promise(() =>
            db.execute(sql`drop trigger fail_sandbox_settlement on sandbox_resource`),
          )
          yield* Effect.promise(() =>
            db.update(sandboxResource).set({ expiresAt: sql`now() + interval '10 minutes'` }),
          )
          const [before] = yield* Effect.promise(() => db.select().from(sandboxResource))
          yield* TestClock.adjust("1 minute")
          const [after] = yield* Effect.promise(() => db.select().from(sandboxResource))
          expect(after!.expiresAt).toEqual(before!.expiresAt)
          expect(after!.settled).toBe(false)
        }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
      )
    } finally {
      await db.execute(sql`drop trigger if exists fail_sandbox_settlement on sandbox_resource`)
      await db.execute(sql`drop function fail_sandbox_settlement()`)
    }
  })

  test("discards rejected authentication but retains a lost creation response for reconciliation", async () => {
    const attempt = () =>
      run(
        Effect.gen(function* () {
          const resources = yield* SandboxResources
          const provider = yield* resources.provider(input())
          yield* Effect.tryPromise(() => provider.create({})).pipe(Effect.flip)
        }),
      )
    rejectedBeforeCreation = true
    createFailure = Object.assign(new Error("Unauthorized"), { status: 401 })
    await attempt()
    expect(await db.select().from(sandboxResource)).toEqual([])
    rejectedBeforeCreation = false
    createFailure = new Error("lost creation response")
    await attempt()
    const rows = await db.select().from(sandboxResource)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.settled).toBe(false)
    await db.update(sandboxResource).set({
      retiredAt: sql`now() - interval '25 hours'`,
      expiresAt: sql`now() - interval '1 minute'`,
    })
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(await db.select().from(sandboxResource)).toEqual([])
  })
})
