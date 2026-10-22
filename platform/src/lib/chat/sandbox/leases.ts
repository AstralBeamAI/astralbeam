import type {
  SandboxDefinition,
  SandboxEnsureContext,
  SandboxInstanceRecord,
  SandboxProvider,
} from "@tanstack/ai-sandbox"
import { Clock, type Duration, Effect } from "effect"

import {
  CHAT_SANDBOX_FILE_TIMEOUT_MS,
  CHAT_SANDBOX_IDLE_TTL_MS,
  CHAT_SANDBOX_MAX_LIVE,
  CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS,
  CHAT_SANDBOX_START_TIMEOUT_MS,
  CHAT_SANDBOX_SWEEP_INTERVAL_MS,
} from "./constants"
import { ChatSandboxUnavailable } from "./errors"
import { chatSandboxCall, logChatSandboxFailure } from "./operations"

interface ChatSandboxLease {
  record: SandboxInstanceRecord | undefined
  /** Kept beside the record so eviction can destroy without re-reading credentials. */
  provider: SandboxProvider
  users: number
  pending: number
  idleSince: number
  cleanup: Promise<void> | undefined
}

// Only this scoped owner mutates lease state. Callers receive a handle held until their scope closes.
export const makeChatSandboxLeases = Effect.gen(function* () {
  // Process-local, so resume works only within one replica: a conversation that lands on
  // another instance starts a new sandbox instead, which costs time but is never incorrect.
  const leases = new Map<string, ChatSandboxLease>()
  const runCleanup = Effect.runPromiseWith(yield* Effect.context<never>())
  let closed = false

  const destroyLease = (key: string, lease: ChatSandboxLease, timeout: Duration.Input) =>
    (lease.cleanup ??= runCleanup(
      Effect.gen(function* () {
        if (lease.record) {
          const id = lease.record.providerSandboxId
          yield* chatSandboxCall((signal) => lease.provider.destroy({ id, signal }), timeout).pipe(
            Effect.catch((error) => logChatSandboxFailure("destroy", error)),
          )
        }
        leases.delete(key)
      }),
    ))

  const sweepIdleLeases = Effect.gen(function* () {
    const cutoff = (yield* Clock.currentTimeMillis) - CHAT_SANDBOX_IDLE_TTL_MS
    const cleanups = [...leases]
      .filter(([, lease]) => lease.users === 0 && lease.pending === 0 && lease.idleSince <= cutoff)
      .map(([key, lease]) => destroyLease(key, lease, CHAT_SANDBOX_FILE_TIMEOUT_MS))
    yield* Effect.forEach(cleanups, (cleanup) => Effect.promise(() => cleanup), {
      concurrency: "unbounded",
      discard: true,
    })
  })
  yield* sweepIdleLeases.pipe(
    Effect.delay(CHAT_SANDBOX_SWEEP_INTERVAL_MS),
    Effect.forever,
    Effect.forkScoped,
  )

  const releaseLease = (key: string, lease: ChatSandboxLease) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.sync(() => {
        lease.users -= 1
        if (lease.users > 0) return
        lease.idleSince = now
        if (lease.pending === 0 && !lease.record) leases.delete(key)
      }),
    )

  const reserveLease = (key: string, provider: SandboxProvider) =>
    Effect.gen(function* () {
      if (closed) return yield* new ChatSandboxUnavailable()
      const existing = leases.get(key)
      if (existing?.cleanup) return existing.cleanup
      if (!existing && leases.size >= CHAT_SANDBOX_MAX_LIVE) {
        const idle = [...leases]
          .filter(([, lease]) => lease.users === 0 && lease.pending === 0)
          .sort(([, a], [, b]) => a.idleSince - b.idleSince)[0]
        if (!idle) return yield* new ChatSandboxUnavailable()
        return destroyLease(idle[0], idle[1], CHAT_SANDBOX_FILE_TIMEOUT_MS)
      }
      const lease = existing ?? {
        provider,
        record: undefined,
        users: 0,
        pending: 0,
        idleSince: 0,
        cleanup: undefined,
      }
      lease.users += 1
      leases.set(key, lease)
      yield* Effect.addFinalizer(() => releaseLease(key, lease))
      return lease
    }).pipe(Effect.uninterruptible)

  // Leases outlive runs but not the process: shutdown and module reloads destroy them all.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true
      yield* Effect.promise(() =>
        Promise.all(
          [...leases]
            .filter(([, lease]) => lease.pending === 0)
            .map(([key, lease]) => destroyLease(key, lease, CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS)),
        ),
      )
    }).pipe(Effect.timeoutOption(CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS)),
  )

  return Effect.fnUntraced(function* ({
    key,
    definition,
    context,
  }: {
    key: string
    definition: SandboxDefinition
    context: Omit<SandboxEnsureContext, "store" | "signal">
  }) {
    const scope = yield* Effect.scope
    let reservation = yield* reserveLease(key, definition.provider)
    while (reservation instanceof Promise) {
      const cleanup = reservation
      yield* Effect.promise(() => cleanup)
      reservation = yield* reserveLease(key, definition.provider)
    }
    const lease = reservation
    if (closed || scope.state._tag === "Closed") return yield* new ChatSandboxUnavailable()
    return yield* chatSandboxCall(async (signal) => {
      lease.pending += 1
      try {
        return await definition.ensure({
          ...context,
          signal,
          store: {
            get: () => Promise.resolve(lease.record ?? null),
            upsert: (record) => {
              lease.record = record
              lease.provider = definition.provider
              return Promise.resolve()
            },
            delete: () => Promise.resolve(void (lease.record = undefined)),
          },
        })
      } finally {
        // A provider may ignore abort. Keep its reservation until the actual promise settles.
        // https://github.com/TanStack/ai/blob/main/packages/ai-sandbox/src/sandbox.ts
        lease.pending -= 1
        if (lease.pending === 0 && (closed || lease.users === 0)) {
          await destroyLease(key, lease, CHAT_SANDBOX_FILE_TIMEOUT_MS)
        }
      }
    }, CHAT_SANDBOX_START_TIMEOUT_MS)
  })
})
