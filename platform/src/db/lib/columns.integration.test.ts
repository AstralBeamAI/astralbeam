import type { OrganizationId } from "@/db/schema/organizations"
import { OrganizationIdSchema, TenantIdSchema } from "@/db/schema/organizations"
import { defineModel, primaryKey, withTransaction } from "@/lib/persistence.server"
import { Tenants } from "@/lib/tenants/tenants"
import { eq, sql } from "drizzle-orm"
import { integer } from "drizzle-orm/pg-core"
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Schema } from "effect"
import { Statement } from "effect/sql"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { closeDatabase, Database, getAuthDatabase, type EffectDatabase } from "../database.ts"
import { organization, sandboxProvider, tenant } from "../schema.ts"
import { text } from "./columns.ts"

const columnIntegration = (() => {
  const url = globalThis.process.env.DATABASE_URL
  if (!url || url === "postgres://test:test@127.0.0.1:5432/test") return { url: undefined }
  const parsed = new URL(url)
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !parsed.pathname.endsWith("_test")
  )
    throw new Error("Use a disposable loopback database ending in _test")
  return { url }
})()

describe.skipIf(!columnIntegration.url)("schema-backed JSONB columns", () => {
  const runtime = ManagedRuntime.make(Tenants.layerNoDeps.pipe(Layer.provideMerge(Database.layer)))
  let db: ReturnType<typeof getAuthDatabase>
  let organizationId: OrganizationId
  beforeAll(async () => {
    db = getAuthDatabase()
    const [row] = await db
      .insert(organization)
      .values({ domain: "example.com", name: "JSONB", slug: "jsonb-test" })
      .returning()
    organizationId = OrganizationIdSchema.make(row!.id)
  })
  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, organizationId))
    await runtime.dispose()
  })

  test("preserves Tenant scope and round trips snapshotted JSON", async () => {
    const tenants = await runtime.runPromise(Tenants)
    const scope = { organizationId }
    const fields = { externalId: "valid" }
    const row = await runtime.runPromise(tenants.create({ scope, fields }))
    expect(row.metadata).toEqual({})
    await expect(runtime.runPromise(tenants.create({ scope, fields }))).rejects.toMatchObject({
      _tag: "TenantExternalIdTaken",
    })
    const metadata = { nested: { list: [1, true, null] }, label: "retained" }
    const updatedAt = new Date(0)
    const write = tenant.update({ organizationId, id: row.id }, { metadata, updatedAt })
    metadata.nested.list[0] = 2
    updatedAt.setUTCFullYear(2030)
    await runtime.runPromise(write)
    const expected = { ...metadata, nested: { list: [1, true, null] } }
    expect((await db.select().from(tenant).where(eq(tenant.id, row.id)))[0]).toMatchObject({
      metadata: expected,
      updatedAt: new Date(0),
    })
    const edit = { scope, id: TenantIdSchema.make(row.id), patch: { name: "Last write" } }
    const foreignScope = {
      organizationId: OrganizationIdSchema.make("019a0000-0000-7000-8000-000000000099"),
    }
    await expect(
      runtime.runPromise(tenants.update({ ...edit, scope: foreignScope })),
    ).rejects.toMatchObject({ _tag: "TenantNotFound" })
    expect(await runtime.runPromise(tenants.update(edit))).toMatchObject({
      name: "Last write",
      metadata: expected,
    })
  })

  test("rejects invalid writes and corrupted reads without silently stripping fields", async () => {
    await expect(
      db.insert(tenant).values({
        organizationId,
        externalId: "invalid",
        metadata: [] as unknown as typeof tenant.$inferInsert.metadata,
      }),
    ).rejects.toThrow()
    expect(await db.select().from(tenant).where(eq(tenant.externalId, "invalid"))).toEqual([])
    await expect(
      db.insert(sandboxProvider).values({
        organizationId,
        name: "Invalid",
        providerType: "docker",
        options: {
          image: "test-image",
          unexpected: true,
        } as unknown as typeof sandboxProvider.$inferInsert.options,
      }),
    ).rejects.toThrow()
    const [row] = await db
      .insert(sandboxProvider)
      .values({
        organizationId,
        name: "Corrupted",
        providerType: "docker",
        options: {},
      })
      .returning()
    const joined = Effect.flatMap(Database, (database) =>
      database.query.organization.findFirst({
        columns: {},
        where: { id: organizationId },
        with: { sandboxProviders: { where: { id: row!.id }, columns: { options: true } } },
      }),
    )
    expect(await runtime.runPromise(joined)).toEqual({ sandboxProviders: [{ options: {} }] })
    for (const invalid of ['{"image":"test-image"}', { image: "test-image", unexpected: true }]) {
      await db.execute(
        sql`update sandbox_provider set options = ${JSON.stringify(invalid)}::jsonb where id = ${row!.id}`,
      )
      await expect(
        db.select().from(sandboxProvider).where(eq(sandboxProvider.id, row!.id)),
      ).rejects.toThrow()
      await expect(runtime.runPromise(joined)).rejects.toThrow()
    }
  })
})

const persistencePrefix = `persistence_${crypto.randomUUID().replaceAll("-", "")}`
const rejectName = sql.identifier(`${persistencePrefix}_reject_name`)
const persistenceTable = defineModel(
  `${persistencePrefix}_records`,
  {
    scope: text().notNull(),
    id: integer().notNull(),
    name: text({ schema: Schema.String.check(Schema.isNonEmpty()) })
      .notNull()
      .default("Original"),
    score: integer().notNull().default(0),
    lockVersion: integer().notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.scope, table.id] })],
)

describe.skipIf(!columnIntegration.url)("internal persistence", () => {
  const runtime = ManagedRuntime.make(Database.layer)
  let db: EffectDatabase
  const stored = (scope: string) =>
    db.select().from(persistenceTable).where(eq(persistenceTable.scope, scope))

  beforeAll(async () => {
    db = await runtime.runPromise(Database)
    await runtime.runPromise(
      Effect.forEach(
        [
          sql`create table ${persistenceTable} (
        scope text not null, id integer not null, name text not null default 'Original',
        score integer not null default 0,
        lock_version integer not null default 0, primary key(scope, id)
      )`,
          sql`create function ${rejectName}() returns trigger language plpgsql as $$
      begin
        if new.name = 'Rejected' then
          insert into ${persistenceTable} (scope,id,name) values ('persisted-audit',-1,'Trigger');
          new.name := '';
        end if;
        return new;
      end; $$`,
          sql`create trigger invalid_returning before update on ${persistenceTable}
        for each row execute function ${rejectName}()`,
        ],
        (statement) => db.execute(statement),
      ),
    )
  })
  afterAll(async () => {
    try {
      if (db)
        await runtime.runPromise(
          Effect.forEach(
            [
              sql`drop table if exists ${persistenceTable}`,
              sql`drop function if exists ${rejectName}()`,
            ],
            (statement) => db.execute(statement),
          ),
        )
    } finally {
      await runtime.dispose()
      await closeDatabase()
    }
  })

  test("rejects malformed writes before SQL and preserves scoped versioned identity", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const key = { scope: "identity", id: 1, lockVersion: 0 }
        const malformed = [
          persistenceTable.insert({ ...key, name: "" }),
          persistenceTable.update(key, { name: undefined }),
          persistenceTable.update(key, { score: 1, id: 2 } as never),
          persistenceTable.delete({ id: 1, lockVersion: 0 } as never),
        ]
        for (const command of malformed) {
          const failure = yield* command.pipe(
            Effect.provideService(Statement.CurrentTransformer, () => Effect.die("Unexpected SQL")),
            Effect.flip,
          )
          expect(failure._tag).toBe("ValidationError")
        }
        yield* persistenceTable.insert(key)
        yield* persistenceTable.insert({ ...key, scope: "other" })
        const competing = yield* Effect.forEach(
          ["First", "Second"],
          (name) => persistenceTable.update(key, { name }).pipe(Effect.result),
          { concurrency: "unbounded" },
        )
        expect(competing.map((result) => result._tag).sort()).toEqual(["Failure", "Success"])
        expect(competing.find((result) => result._tag === "Failure")?.failure).toMatchObject({
          _tag: "StaleWrite",
        })
        expect(yield* stored("other")).toMatchObject([{ name: "Original", lockVersion: 0 }])
        expect(yield* persistenceTable.delete({ ...key, lockVersion: 1 })).toEqual({
          scope: key.scope,
          id: key.id,
        })
        expect(yield* stored(key.scope)).toEqual([])
      }),
    ))

  test.each([
    ["candidate", { score: 1 }],
    ["persisted", { name: "Rejected" }],
  ] as const)("rolls back recovered %s validation failures", (scope, patch) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const key = { scope, id: 1 }
        yield* persistenceTable.insert(key)
        if (scope === "candidate")
          yield* db.execute(
            sql`update ${persistenceTable} set name = '' where scope = ${key.scope} and id = ${key.id}`,
          )
        const mark = (id: number, name: string) =>
          db.insert(persistenceTable).values({ scope: `${scope}-audit`, id, name })
        const failure = yield* db.transaction(() =>
          persistenceTable
            .update({ ...key, lockVersion: 0 }, patch, {
              onLocked: () => mark(1, "Attempt"),
            })
            .pipe(
              Effect.flip,
              Effect.tap(() => mark(2, "Recovered")),
            ),
        )
        expect(failure).toMatchObject({ _tag: "ValidationError", phase: scope })
        expect(yield* stored(scope)).toMatchObject([
          { name: scope === "candidate" ? "" : "Original", score: 0, lockVersion: 0 },
        ])
        expect(yield* stored(`${scope}-audit`)).toMatchObject([{ name: "Recovered" }])
      }),
    ),
  )

  test("captures commands and isolates each evaluation from caller and callback mutation", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const key = { scope: "snapshot", id: 1, lockVersion: 0 }
        const insert = persistenceTable.insert(key)
        const identity = { ...key, unrelated: () => undefined }
        const patch = { score: 1 }
        const command = persistenceTable.update(identity, patch, {
          onLocked: (row) => Effect.sync(() => Reflect.set(row, "name", "")),
        })
        identity.scope = "wrong"
        identity.lockVersion = 99
        patch.score = 99
        yield* insert
        const failure = yield* withTransaction(
          command.pipe(Effect.andThen(Effect.fail("retry"))),
        ).pipe(Effect.flip)
        expect(failure).toBe("retry")
        expect(yield* command).toMatchObject({ ...key, name: "Original", score: 1, lockVersion: 1 })
        expect(yield* stored("wrong")).toEqual([])
      }),
    ))

  test("rolls back an interrupted savepoint before a sibling runs", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const key = { scope: "ownership", id: 1 }
        yield* persistenceTable.insert(key)
        yield* db
          .transaction(() =>
            Effect.gen(function* () {
              const entered = Deferred.makeUnsafe<void>()
              const writing = yield* Effect.forkChild(
                withTransaction(
                  persistenceTable
                    .update({ ...key, lockVersion: 0 }, { name: "Interrupted" })
                    .pipe(
                      Effect.andThen(Deferred.succeed(entered, undefined)),
                      Effect.andThen(Effect.never),
                    ),
                ),
              )
              yield* Deferred.await(entered)
              const next = yield* Effect.forkChild(
                persistenceTable.update({ ...key, lockVersion: 0 }, { score: 20 }),
                { startImmediately: true },
              )
              yield* Fiber.interrupt(writing)
              expect(yield* Fiber.join(next)).toMatchObject({
                name: "Original",
                score: 20,
                lockVersion: 1,
              })
            }),
          )
          .pipe(Effect.timeout("5 seconds"))
      }),
    ))
})
