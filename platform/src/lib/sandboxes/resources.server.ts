import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { Database } from "@/db/database"
import { makeDatabaseCache, withDatabaseCacheLock, tryWithDatabaseCacheLock } from "@/db/cache"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { encryptDatabaseValue, decryptDatabaseValue } from "@/db/lib/encryption"
import { APP_HANDLE } from "@/lib/constants"
import {
  SandboxCleanupFailed,
  SandboxResourceUnavailable,
  SandboxProviderUnavailable,
} from "./errors"
import { SandboxProviderFactory } from "./factory.server"
import { SandboxProviderConfigurationSchema, type SandboxProviderId } from "./schemas"

export const SANDBOX_RESOURCE_NAMESPACE = "sandbox-resources:v1"
const ownerLifetime = 15 * 60_000
const cleanupRetry = 5 * 60_000
const uncertainCreationLifetime = 24 * 60 * 60_000
const SandboxOwnershipSchema = Schema.Struct({
  ownerId: Schema.String,
  scope: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
  retiredAt: Schema.NullOr(Schema.Number),
  settled: Schema.Boolean,
  configuration: Schema.String,
})
const SandboxCleanupConfigurationSchema = Schema.Struct({
  key: Schema.String,
  configuration: SandboxProviderConfigurationSchema,
})
type Ownership = typeof SandboxOwnershipSchema.Type
interface SandboxResourceInput {
  organizationId: string
  provider: SandboxProviderId
  options: unknown
  credentials: unknown
}
const resourceKey = (organizationId: string, id: string) => `${organizationId}:${id}`

const makeSandboxResources = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const factory = yield* SandboxProviderFactory
  const store = yield* makeDatabaseCache({
    namespace: SANDBOX_RESOURCE_NAMESPACE,
    schema: SandboxOwnershipSchema,
  })
  const run = Effect.runPromiseWith(yield* Effect.context<SqlClient.SqlClient>())
  const ownerId = crypto.randomUUID()
  const owned = new Map<string, string>()
  const ownerScope = yield* Effect.scope
  const isClosed = () => ownerScope.state._tag === "Closed"
  const databaseNow = sql<{
    now: number
  }>`select (extract(epoch from statement_timestamp()) * 1000)::double precision as now`.pipe(
    Effect.map((rows) => rows[0]!.now),
  )
  const lock = <A, E, R>(key: string, execute: Effect.Effect<A, E, R>) =>
    withDatabaseCacheLock({ namespace: SANDBOX_RESOURCE_NAMESPACE, key }, execute).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
    )

  const hasMembers = (organizationId: string) =>
    sql`select 1 from member where organization_id = ${organizationId} limit 1`.pipe(
      Effect.map((rows) => rows.length > 0),
    )

  const touch = Effect.fn("SandboxResources.touch")(
    function* (organizationId: string, id: string) {
      if (isClosed()) return yield* new SandboxResourceUnavailable()
      const key = resourceKey(organizationId, id)
      yield* lock(
        key,
        Effect.gen(function* () {
          const found = yield* store.get(key)
          const now = yield* databaseNow
          if (
            !(yield* hasMembers(organizationId)) ||
            Option.isNone(found) ||
            found.value.ownerId !== ownerId ||
            found.value.retiredAt !== null ||
            found.value.expiresAt <= now
          ) {
            owned.delete(id)
            return yield* new SandboxResourceUnavailable()
          }
          yield* store.set(key, { ...found.value, expiresAt: now + ownerLifetime })
        }),
      )
    },
    Effect.catchCause(() => Effect.fail(new SandboxResourceUnavailable())),
  )

  const retire = (key: string) =>
    lock(
      key,
      Effect.gen(function* () {
        const now = yield* databaseNow
        return yield* store
          .modify(key, (row) => ({
            ...row,
            retiredAt: row.retiredAt ?? now,
            expiresAt: now + cleanupRetry,
          }))
          .pipe(Effect.map(Option.getOrUndefined))
      }),
    )

  const cleanupConnection = Effect.fnUntraced(function* (key: string, row: Ownership) {
    const payload = yield* Effect.fromResult(
      decryptDatabaseValue({
        storedValue: row.configuration,
        schema: SandboxCleanupConfigurationSchema,
        keyring: getDatabaseEncryptionKeyring(),
      }),
    ).pipe(
      Effect.map((value) => value.value),
      Effect.orDie,
    )
    if (payload.key !== key)
      return yield* Effect.die(new Error("Sandbox cleanup configuration identity mismatch"))
    const connection = yield* factory.create(
      payload.configuration.providerType,
      payload.configuration,
    )
    return { connection, id: key.slice(key.indexOf(":") + 1) }
  })

  const destroy = Effect.fnUntraced(function* (key: string, claimed?: Ownership) {
    const row = claimed ?? (yield* retire(key))
    if (!row) return
    const { connection, id } = yield* cleanupConnection(key, row)
    owned.delete(id)
    const scope = yield* Effect.promise(() => connection.resourceScope)
    if ((scope ?? null) !== row.scope) return yield* new SandboxResourceUnavailable()
    const provider = yield* Effect.promise(() => connection.provider)
    yield* Effect.tryPromise((signal) => provider.destroy({ id, signal })).pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError(() => new SandboxCleanupFailed()),
    )
    yield* lock(
      key,
      Effect.gen(function* () {
        const latest = yield* store.get(key)
        if (Option.isNone(latest)) return
        const now = yield* databaseNow
        // An uncertain create can finish remotely after cleanup. Reconcile its name for one day.
        if (
          (row.settled && latest.value.settled) ||
          now - (latest.value.retiredAt ?? now) >= uncertainCreationLifetime
        )
          yield* store.remove(key)
      }),
    )
  })

  const reap = Effect.fn("SandboxResources.reap")(function* () {
    const keys = yield* store.keys
    const now = yield* databaseNow
    const claimed: { key: string; row: Ownership }[] = []
    for (const key of keys) {
      const candidate = yield* store.get(key)
      if (Option.isNone(candidate) || candidate.value.expiresAt > now) continue
      if (candidate.value.scope !== null) {
        const matching = yield* cleanupConnection(key, candidate.value).pipe(
          Effect.flatMap(({ connection }) => Effect.promise(() => connection.resourceScope)),
          Effect.map((scope) => scope === candidate.value.scope),
          Effect.catchCause(() => Effect.succeed(false)),
        )
        if (!matching) continue
      }
      const result = yield* tryWithDatabaseCacheLock(
        { namespace: SANDBOX_RESOURCE_NAMESPACE, key },
        Effect.gen(function* () {
          const row = yield* store.get(key)
          if (Option.isNone(row) || row.value.expiresAt > now) return
          const retired = {
            ...row.value,
            retiredAt: row.value.retiredAt ?? now,
            expiresAt: now + cleanupRetry,
          }
          yield* store.set(key, retired)
          return retired
        }),
      )
      const row = Option.getOrUndefined(result)
      if (row) claimed.push({ key, row })
      if (claimed.length === 25) break
    }
    yield* Effect.forEach(
      claimed,
      ({ key, row }) =>
        destroy(key, row).pipe(
          Effect.catchCause(() => Effect.logWarning("Sandbox cleanup will retry")),
          Effect.annotateLogs({ resourceKey: key }),
        ),
      { concurrency: 4, discard: true },
    )
  })

  // Every host also reconciles so local Docker/VM resources return to their own daemon.
  yield* Effect.suspend(() =>
    Effect.forEach(
      owned,
      ([id, organizationId]) =>
        touch(organizationId, id).pipe(
          Effect.catch(() => Effect.logWarning("Sandbox ownership renewal failed")),
        ),
      {
        concurrency: 4,
        discard: true,
      },
    ),
  ).pipe(
    Effect.andThen(() => reap()),
    Effect.catchCause(() => Effect.logWarning("Sandbox cleanup will retry")),
    Effect.delay("1 minute"),
    Effect.forever,
    Effect.forkScoped,
  )

  const provider = Effect.fn("SandboxResources.provider")(function* (input: SandboxResourceInput) {
    const configuration = yield* Schema.decodeUnknownEffect(SandboxProviderConfigurationSchema)({
      providerType: input.provider,
      options: input.options,
      credentials: input.credentials,
    }).pipe(Effect.mapError((cause) => new SandboxProviderUnavailable({ cause })))
    const connection = yield* factory.create(configuration.providerType, configuration)
    const adapter = yield* Effect.promise(() => connection.provider)
    const scope = (yield* Effect.promise(() => connection.resourceScope)) ?? null
    const remove = (id: string) => {
      owned.delete(id)
      return run(destroy(resourceKey(input.organizationId, id)))
    }
    const wrap = (handle: SandboxHandle, id: string): SandboxHandle => ({
      id,
      provider: handle.provider,
      ...(handle.workspaceRoot === undefined ? {} : { workspaceRoot: handle.workspaceRoot }),
      capabilities: { ...handle.capabilities, snapshots: false, fork: false },
      fs: handle.fs,
      git: handle.git,
      process: handle.process,
      ports: handle.ports,
      env: handle.env,
      destroy: () => remove(id),
    })
    return {
      name: adapter.name,
      capabilities: () => ({ ...adapter.capabilities(), snapshots: false, fork: false }),
      create: async (options) => {
        if (isClosed()) throw new SandboxResourceUnavailable()
        const [identity] = await run(sql<{ id: string }>`select uuidv7() as id`)
        const id = `${APP_HANDLE}-${identity!.id}`
        const key = resourceKey(input.organizationId, id)
        if (await adapter.resume({ id, ...(options.signal ? { signal: options.signal } : {}) }))
          throw new SandboxResourceUnavailable()
        options.signal?.throwIfAborted()
        const encrypted = await run(
          Effect.fromResult(
            encryptDatabaseValue({
              value: {
                key,
                configuration,
              },
              schema: SandboxCleanupConfigurationSchema,
              keyring: getDatabaseEncryptionKeyring(),
            }),
          ),
        )
        await run(
          lock(
            key,
            Effect.gen(function* () {
              if (!(yield* hasMembers(input.organizationId)))
                return yield* new SandboxResourceUnavailable()
              const now = yield* databaseNow
              yield* store.set(key, {
                ownerId,
                scope,
                expiresAt: now + ownerLifetime,
                retiredAt: null,
                settled: false,
                configuration: encrypted,
              })
            }),
          ),
        )
        owned.set(id, input.organizationId)
        let succeeded = false
        let settled = true
        try {
          if (isClosed()) throw new SandboxResourceUnavailable()
          options.signal?.throwIfAborted()
          settled = false
          const handle = await adapter.create({ ...options, id })
          settled = true
          await run(touch(input.organizationId, id))
          options.signal?.throwIfAborted()
          succeeded = true
          return wrap(handle, id)
        } finally {
          if (!succeeded) owned.delete(id)
          await run(
            lock(
              key,
              Effect.gen(function* () {
                const now = yield* databaseNow
                yield* store.modify(key, (row) => ({
                  ...row,
                  settled,
                  ...(!succeeded ? { retiredAt: row.retiredAt ?? now, expiresAt: now } : {}),
                }))
              }),
            ),
          ).catch((cause: unknown) => {
            owned.delete(id)
            throw cause
          })
          if (!succeeded)
            await run(
              destroy(key).pipe(
                Effect.catchCause(() => Effect.logWarning("Sandbox cleanup will retry")),
              ),
            )
        }
      },
      resume: async ({ id, signal }) => {
        const ownership = await run(touch(input.organizationId, id).pipe(Effect.result))
        if (ownership._tag === "Failure") return null
        const handle = await adapter.resume({ id, ...(signal ? { signal } : {}) })
        if (!handle) await remove(id)
        return handle ? wrap(handle, id) : null
      },
      destroy: ({ id }) => remove(id),
    } satisfies SandboxProvider
  })
  return {
    provider: (input: SandboxResourceInput) =>
      provider(input).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
    touch,
    reap: () => reap().pipe(Effect.orDie, Effect.provideService(SqlClient.SqlClient, sql)),
  }
})

/** Durable ownership in the existing, non-expiring encrypted KV journal. */
export class SandboxResources extends Context.Service<
  SandboxResources,
  Effect.Success<typeof makeSandboxResources>
>()("astralbeam/sandboxes/SandboxResources") {
  static readonly layerNoDeps = Layer.effect(SandboxResources, makeSandboxResources)
  static readonly layer = SandboxResources.layerNoDeps.pipe(
    Layer.provide([Database.layer, SandboxProviderFactory.layer]),
  )
}
