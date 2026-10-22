import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { beforeEach, describe, expect, test } from "vitest"
import { TestClock } from "effect/testing"

import { Database, getAuthDatabase } from "@/db/database"
import { organization, member, OrganizationIdSchema } from "@/db/schema/organizations"
import { cacheEntry } from "@/db/schema/cache"
import { SandboxConnection } from "@astralbeam/sandbox"
import { SandboxProviderFactory } from "./factory.server"
import { SandboxResources, SANDBOX_RESOURCE_NAMESPACE } from "./resources.server"

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
let organizationIdForAdapter: string
let resourceScope = "local:original"
const adapter = {
  name: "daytona",
  capabilities: () => ({}),
  create: async ({ id }: { id: string }) => {
    expect(
      await getAuthDatabase()
        .select()
        .from(cacheEntry)
        .where(eq(cacheEntry.key, `${organizationIdForAdapter}:${id}`)),
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
    Layer.succeed(SandboxProviderFactory, {
      create: () =>
        Effect.succeed(
          new SandboxConnection(
            () => adapter,
            () => Promise.resolve(resourceScope),
          ),
        ),
    }),
  ]),
)
const run = <A, E>(effect: Effect.Effect<A, E, SandboxResources>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe.skipIf(!enabled)("durable sandbox ownership", () => {
  const db = getAuthDatabase()
  const records = async () =>
    (
      await db.execute<{
        record: { expiresAt: number; retiredAt: number | null; settled: boolean }
      }>(
        sql`select value::jsonb as record from cache_entry where namespace=${SANDBOX_RESOURCE_NAMESPACE}`,
      )
    ).rows.map((row) => row.record)
  const change = (fields: { expiresAt?: number; retiredAt?: number }) =>
    db.execute(
      sql`update cache_entry set value=(value::jsonb || ${JSON.stringify(fields)}::jsonb)::text,updated_at=now() where namespace=${SANDBOX_RESOURCE_NAMESPACE}`,
    )
  let organizationId: string
  const input = () => ({
    organizationId,
    provider: "daytona" as const,
    options: { target: "us", snapshot: "test" },
    credentials: { apiKey: "original-credential" },
  })
  beforeEach(async () => {
    await db.execute(sql`truncate organization, "user", cache_entry cascade`)
    const {
      rows: [row],
    } = await db.execute<{ id: string }>(sql`with org as (
      insert into organization (domain,name,slug) values ('example.com','Sandbox recovery','sandbox-recovery') returning id
    ), owner as (
      insert into "user" (name,email) values ('Owner','sandbox-owner@example.com') returning id
    ), membership as (
      insert into member (organization_id,user_id,role) select org.id,owner.id,'owner' from org,owner
    ) select id from org`)
    organizationId = row!.id
    organizationIdForAdapter = organizationId
    remote.clear()
    failDelete = false
    createGate = undefined
    created = undefined
    createFailure = undefined
    rejectedBeforeCreation = false
    resourceScope = "local:original"
  })

  test("cleanup survives Organization deletion and retries expired ownership", async () => {
    const id = await run(
      Effect.gen(function* () {
        const resources = yield* SandboxResources
        const provider = yield* resources.provider(input())
        const handle = yield* Effect.promise(() => provider.create({}))
        yield* resources.touch(organizationId, handle.id)
        yield* resources.reap()
        expect(remote.has(handle.id)).toBe(true)
        yield* Effect.promise(() =>
          db
            .delete(organization)
            .where(eq(organization.id, OrganizationIdSchema.make(organizationId))),
        )
        expect((yield* Effect.flip(resources.touch(organizationId, handle.id)))._tag).toBe(
          "SandboxResourceUnavailable",
        )
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
        sql`select value as stored from cache_entry where namespace = ${SANDBOX_RESOURCE_NAMESPACE}`,
      )
    ).rows
    expect(stored[0]!.stored).not.toContain("original-credential")
    expect((await db.select().from(cacheEntry))[0]!.expiresAt).toBeNull()
    await change({ expiresAt: 0 })
    resourceScope = "local:other-host"
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(remote.has(id)).toBe(true)
    resourceScope = "local:original"
    failDelete = true
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(remote.has(id)).toBe(true)
    expect((await records())[0]?.retiredAt).toEqual(expect.any(Number))
    await expect(
      run(Effect.flatMap(SandboxResources, (resources) => resources.touch(organizationId, id))),
    ).rejects.toThrow()
    failDelete = false
    await change({ expiresAt: 0 })
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(remote.size).toBe(0)
    expect(await records()).toEqual([])
  })

  test("retains an uncertain creation intent and cleans a late result after ownership is lost", async () => {
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    createGate = gate.promise
    created = started.resolve
    const owner = ManagedRuntime.make(layer)
    const resources = await owner.runPromise(SandboxResources)
    const provider = await Effect.runPromise(resources.provider(input()))
    const pending = provider.create({}).then(
      () => true,
      () => false,
    )
    try {
      await started.promise
      await owner.dispose()
      await change({ expiresAt: 0 })
      await run(Effect.flatMap(SandboxResources, (nextOwner) => nextOwner.reap()))
      expect(remote.size).toBe(0)
      const rows = await records()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.settled).toBe(false)
      expect(rows[0]?.retiredAt).toEqual(expect.any(Number))
      gate.resolve()
      expect(await pending).toBe(false)
      expect(await records()).toEqual([])
    } finally {
      gate.resolve()
      await owner.dispose()
      await pending
    }
  })

  test("does not renew an orphan when saving its creation outcome fails", async () => {
    await db.execute(sql`create function fail_sandbox_settlement() returns trigger language plpgsql as $$
      begin if (new.value::jsonb->>'settled')::boolean then raise exception 'injected settlement failure'; end if; return new; end $$`)
    await db.execute(sql`create trigger fail_sandbox_settlement before update on cache_entry
      for each row execute function fail_sandbox_settlement()`)
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const resources = yield* SandboxResources
          const provider = yield* resources.provider(input())
          yield* Effect.tryPromise(() => provider.create({})).pipe(Effect.flip)
          yield* Effect.promise(() =>
            db.execute(sql`drop trigger fail_sandbox_settlement on cache_entry`),
          )
          yield* Effect.promise(() => change({ expiresAt: Date.now() + 10 * 60_000 }))
          const [before] = yield* Effect.promise(records)
          yield* TestClock.adjust("1 minute")
          const [after] = yield* Effect.promise(records)
          expect(after!.expiresAt).toEqual(before!.expiresAt)
          expect(after!.settled).toBe(false)
        }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
      )
    } finally {
      await db.execute(sql`drop trigger if exists fail_sandbox_settlement on cache_entry`)
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
    expect(await records()).toEqual([])
    rejectedBeforeCreation = false
    createFailure = new Error("lost creation response")
    await attempt()
    const rows = await records()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.settled).toBe(false)
    await change({ retiredAt: Date.now() - 25 * 60 * 60_000, expiresAt: 0 })
    await run(Effect.flatMap(SandboxResources, (resources) => resources.reap()))
    expect(await records()).toEqual([])
    await db.delete(member)
    createFailure = undefined
    await attempt()
    expect(await records()).toEqual([])
  })
})
