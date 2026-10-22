import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Result, Schema } from "effect"

import { Database } from "@/db/database"
import { sandboxResource } from "@/db/schema/sandboxes"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { APP_HANDLE } from "@/lib/constants"
import { sandboxCall, logSandboxFailure, sandboxErrorCode } from "./operations.server"
import {
  SandboxCleanupFailed,
  SandboxResourceUnavailable,
  SandboxProviderUnavailable,
} from "./errors"
import { SandboxProviderFactory } from "./factory.server"
import { SandboxProviderConfigurationSchema, type SandboxProviderId } from "./schemas"

const expiry = sql`now() + interval '15 minutes'`
const retryAt = sql`now() + interval '5 minutes'`
const retiredAt = sql`coalesce(${sandboxResource.retiredAt}, now())`
type ResourceIdentity = { organizationId: string; id: string }
interface SandboxResourceInput {
  organizationId: string
  provider: SandboxProviderId
  options: unknown
  credentials: unknown
}
const resourceWhere = ({ organizationId, id }: ResourceIdentity) =>
  and(eq(sandboxResource.organizationId, organizationId), eq(sandboxResource.id, id))

/** Durable ownership survives callers, provider edits, and process loss. */
export class SandboxResources extends Context.Service<
  SandboxResources,
  {
    readonly provider: (
      input: SandboxResourceInput,
    ) => Effect.Effect<SandboxProvider, SandboxProviderUnavailable>
    readonly touch: (
      organizationId: string,
      providerSandboxId: string,
    ) => Effect.Effect<void, SandboxResourceUnavailable>
    readonly reap: (organizationId?: string) => Effect.Effect<void>
    readonly purgeOrganization: (
      organizationId: string,
    ) => Effect.Effect<void, SandboxCleanupFailed>
  }
>()("astralbeam/sandboxes/SandboxResources") {
  static readonly layerNoDeps = Layer.effect(
    SandboxResources,
    Effect.gen(function* () {
      const db = yield* Database
      const factory = yield* SandboxProviderFactory
      const run = Effect.runPromiseWith(yield* Effect.context<never>())
      const ownerId = crypto.randomUUID()
      const owned = new Map<string, string>()
      let closed = false
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true
        }),
      )

      yield* Effect.suspend(() =>
        owned.size === 0
          ? Effect.void
          : db
              .update(sandboxResource)
              .set({ expiresAt: expiry })
              .where(
                and(
                  eq(sandboxResource.ownerId, ownerId),
                  inArray(sandboxResource.id, [...owned.values()]),
                  isNull(sandboxResource.retiredAt),
                  gt(sandboxResource.expiresAt, sql`now()`),
                ),
              )
              .pipe(Effect.asVoid),
      ).pipe(
        Effect.catchCause(() => Effect.logWarning("Sandbox ownership renewal failed")),
        Effect.delay("1 minute"),
        Effect.forever,
        Effect.forkScoped,
      )

      const touch = Effect.fn("SandboxResources.touch")(function* (
        organizationId: string,
        providerSandboxId: string,
      ) {
        if (closed) return yield* new SandboxResourceUnavailable()
        const renewed = yield* db
          .update(sandboxResource)
          .set({ expiresAt: expiry })
          .where(
            and(
              eq(sandboxResource.organizationId, organizationId),
              eq(sandboxResource.providerSandboxId, providerSandboxId),
              eq(sandboxResource.ownerId, ownerId),
              isNull(sandboxResource.retiredAt),
              gt(sandboxResource.expiresAt, sql`now()`),
            ),
          )
          .returning({ id: sandboxResource.id })
          .pipe(Effect.catchCause(() => Effect.fail(new SandboxResourceUnavailable())))
        if (renewed.length === 0) {
          owned.delete(providerSandboxId)
          return yield* new SandboxResourceUnavailable()
        }
      })

      const destroy = Effect.fnUntraced(function* (identity: ResourceIdentity) {
        const [row] = yield* db
          .update(sandboxResource)
          .set({ retiredAt, expiresAt: retryAt })
          .where(resourceWhere(identity))
          .returning()
        if (!row) return
        owned.delete(row.providerSandboxId)
        const payload = row.configuration
        if (
          payload.organizationId !== row.organizationId ||
          payload.resourceId !== row.id ||
          payload.providerSandboxId !== row.providerSandboxId
        ) {
          return yield* Effect.die(new Error("Sandbox cleanup configuration identity mismatch"))
        }
        const provider = yield* factory.create(
          payload.configuration.providerType,
          payload.configuration,
        )
        yield* sandboxCall(
          (signal) => provider.destroy({ id: row.providerSandboxId, signal }),
          "30 seconds",
        )
        // A crashed create may still finish remotely. Reconcile its name for a day before retiring the intent.
        yield* db
          .delete(sandboxResource)
          .where(
            and(
              resourceWhere(identity),
              or(
                eq(sandboxResource.settled, true),
                sql`${sandboxResource.retiredAt} < now() - interval '1 day'`,
              ),
            ),
          )
      })

      const reap = Effect.fn("SandboxResources.reap")(function* (
        organizationId: string | undefined,
      ) {
        const rows = yield* db
          .update(sandboxResource)
          .set({ retiredAt, expiresAt: retryAt })
          .where(sql`(${sandboxResource.organizationId}, ${sandboxResource.id}) in (
          select organization_id, id from sandbox_resource
          where ${organizationId ? sql`organization_id = ${organizationId}` : sql`true`}
            and ${organizationId ? sql`true` : sql`expires_at <= now()`}
          order by expires_at, id limit 25 for update skip locked
        )`)
          .returning({ organizationId: sandboxResource.organizationId, id: sandboxResource.id })
        yield* Effect.forEach(
          rows,
          (row) =>
            destroy(row).pipe(
              Effect.catchTag("SandboxOperationFailed", (error) =>
                logSandboxFailure("reconcile", error),
              ),
              Effect.catchCause(() => Effect.logWarning("Sandbox cleanup will retry")),
              Effect.annotateLogs({ organizationId: row.organizationId, resourceId: row.id }),
            ),
          { concurrency: 4, discard: true },
        )
      }, Effect.orDie)

      const purgeOrganization = Effect.fn("SandboxResources.purgeOrganization")(function* (
        organizationId: string,
      ) {
        yield* reap(organizationId)
        const remaining = yield* db
          .select({ id: sandboxResource.id })
          .from(sandboxResource)
          .where(eq(sandboxResource.organizationId, organizationId))
          .limit(1)
          .pipe(mapDatabaseErrors())
        if (remaining.length > 0) return yield* new SandboxCleanupFailed()
      })

      const provider = Effect.fn("SandboxResources.provider")(function* (
        input: SandboxResourceInput,
      ) {
        const adapter = yield* factory.create(input.provider, input)
        const configuration = yield* Schema.decodeUnknownEffect(SandboxProviderConfigurationSchema)(
          {
            providerType: input.provider,
            options: input.options,
            credentials: input.credentials,
          },
        ).pipe(Effect.mapError((cause) => new SandboxProviderUnavailable({ cause })))
        const remove = async (id: string) => {
          owned.delete(id)
          const rows = await run(
            db
              .select({ id: sandboxResource.id, organizationId: sandboxResource.organizationId })
              .from(sandboxResource)
              .where(
                and(
                  eq(sandboxResource.organizationId, input.organizationId),
                  eq(sandboxResource.ownerId, ownerId),
                  eq(sandboxResource.providerSandboxId, id),
                ),
              ),
          )
          for (const row of rows) await run(destroy(row))
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
            if (closed) throw new SandboxResourceUnavailable()
            const {
              rows: [identity],
            } = await run(db.execute<{ id: string }>(sql`select uuidv7() as id`))
            const id = identity!.id
            const providerSandboxId = `${APP_HANDLE}-${id}`
            const row = { organizationId: input.organizationId, id }
            // Probe a fresh name before retaining credentials for an allocation that may never be accepted.
            if (
              await adapter.resume({
                id: providerSandboxId,
                ...(options.signal ? { signal: options.signal } : {}),
              })
            ) {
              throw new SandboxResourceUnavailable()
            }
            options.signal?.throwIfAborted()
            await run(
              db.insert(sandboxResource).values({
                ...row,
                ownerId,
                providerSandboxId,
                expiresAt: expiry,
                configuration: {
                  organizationId: input.organizationId,
                  resourceId: id,
                  providerSandboxId,
                  configuration,
                },
              }),
            )
            owned.set(providerSandboxId, id)
            let succeeded = false
            let settled = true
            try {
              if (closed) throw new SandboxResourceUnavailable()
              options.signal?.throwIfAborted()
              settled = false
              const handle = await adapter
                .create({ ...options, id: providerSandboxId })
                .catch((cause: unknown) => {
                  const code = sandboxErrorCode(cause)
                  settled = code !== "timeout" && code !== "cancelled" && code !== "provider_error"
                  throw cause
                })
              settled = true
              await run(touch(input.organizationId, providerSandboxId))
              options.signal?.throwIfAborted()
              succeeded = true
              return wrap(handle, providerSandboxId)
            } finally {
              if (!succeeded) owned.delete(providerSandboxId)
              await run(
                db
                  .update(sandboxResource)
                  .set({
                    settled,
                    ...(!succeeded ? { retiredAt, expiresAt: sql`now()` } : {}),
                  })
                  .where(resourceWhere(row)),
              ).catch((cause: unknown) => {
                owned.delete(providerSandboxId)
                throw cause
              })
              if (!succeeded)
                await run(
                  destroy(row).pipe(
                    Effect.catchCause(() => Effect.logWarning("Sandbox cleanup will retry")),
                  ),
                )
            }
          },
          resume: async ({ id, signal }) => {
            const ownership = await run(touch(input.organizationId, id).pipe(Effect.result))
            if (Result.isFailure(ownership)) {
              await remove(id)
              return null
            }
            const handle = await adapter.resume({ id, ...(signal ? { signal } : {}) })
            if (!handle) await remove(id)
            return handle ? wrap(handle, id) : null
          },
          destroy: ({ id }) => remove(id),
        } satisfies SandboxProvider
      })
      return { provider, touch, reap, purgeOrganization }
    }),
  )
  static readonly layer = SandboxResources.layerNoDeps.pipe(
    Layer.provide([Database.layer, SandboxProviderFactory.layer]),
  )
}
