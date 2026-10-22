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
  cleanup: Promise<boolean> | undefined
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
      chatSandboxCall(async (signal) => {
        try {
          if (lease.record) {
            await lease.provider.destroy({ id: lease.record.providerSandboxId, signal })
          }
          leases.delete(key)
        } finally {
          // Abort may not stop deletion. Only provider settlement releases the cleanup fence.
          // https://github.com/AstralBeamAI/astralbeam/pull/344#discussion_r4348581923
          lease.cleanup = undefined
        }
      }, timeout).pipe(
        Effect.as(true),
        Effect.catch((error) => logChatSandboxFailure("destroy", error).pipe(Effect.as(false))),
      ),
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

  // Shutdown and module reloads attempt bounded cleanup of every settled lease.
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
      if (!(yield* Effect.promise(() => cleanup))) return yield* new ChatSandboxUnavailable()
      reservation = yield* reserveLease(key, definition.provider)
    }
    const lease = reservation
    return yield* chatSandboxCall(async (signal) => {
      // Shutdown can run before this callback starts. Check and reserve without yielding.
      if (closed || scope.state._tag === "Closed") throw new ChatSandboxUnavailable()
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
