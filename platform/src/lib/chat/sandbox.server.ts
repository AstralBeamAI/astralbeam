import {
  defineSandbox,
  resolveHarnessCwd,
  type SandboxHandle,
  type SandboxInstanceRecord,
  type SandboxInstanceStore,
  type SandboxProvider,
} from "@tanstack/ai-sandbox"
import {
  Clock,
  Context,
  Deferred,
  type Duration,
  Effect,
  FiberHandle,
  FiberSet,
  Layer,
  MutableHashMap,
  Option,
  Ref,
} from "effect"

import { APP_HANDLE } from "@/lib/constants"
import { errorReason } from "@/lib/runtime/failure-report.server"
import { createSandboxProvider } from "@/lib/sandboxes/factory.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import {
  artifactContentDigest,
  deriveArtifactTicketKey,
  detectSandboxArtifactMimeType,
  mintSandboxArtifactTicket,
  type SandboxArtifactTicket,
  verifySandboxArtifactTicket,
} from "./artifacts.server"
import {
  CHAT_ATTACHMENT_UPLOAD_DIRECTORY,
  CHAT_SANDBOX_FILE_TIMEOUT_MS,
  CHAT_SANDBOX_IDLE_TTL_MS,
  CHAT_SANDBOX_MAX_ARTIFACT_BYTES,
  CHAT_SANDBOX_MAX_LIVE,
  CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS,
  CHAT_SANDBOX_START_TIMEOUT_MS,
  CHAT_SANDBOX_SWEEP_INTERVAL_MS,
} from "./constants.server"
import {
  ChatArtifactUnavailable,
  ChatSandboxConfigurationUnreadable,
  ChatSandboxOperationFailed,
  ChatSandboxUnavailable,
} from "./errors.ts"
import { chatPrincipalScope } from "./identity.server"
import { resolveSandboxPath } from "./sandbox-paths.server"
import type { ChatAttachmentFile, ChatPrincipal, ChatSandboxStatus } from "./types"

// The first sandbox tool a run calls provisions the sandbox, so an ordinary reply costs nothing,
// and `reuse: "thread"` keeps it for the conversation so the agent builds on its own files.

/** Wraps one vendor sandbox call: a timeout interrupts it, and its error never reaches the agent. */
export function chatSandboxCall<A>(
  call: (signal: AbortSignal) => PromiseLike<A>,
  timeout: Duration.Input,
) {
  return Effect.tryPromise({
    try: call,
    catch: (cause) => new ChatSandboxOperationFailed({ timedOut: false, cause }),
  }).pipe(
    Effect.timeout(timeout),
    Effect.catchTag("TimeoutError", (cause) =>
      Effect.fail(new ChatSandboxOperationFailed({ timedOut: true, cause })),
    ),
  )
}

/** Logs why a sandbox call failed with its vendor code or type only. */
export function logChatSandboxFailure(operation: string, error: ChatSandboxOperationFailed) {
  return Effect.logWarning("Chat sandbox operation failed").pipe(
    Effect.annotateLogs({ operation, timedOut: error.timedOut, reason: errorReason(error.cause) }),
  )
}

/** One run's sandbox, provisioned on first use and shared by every tool call after it. */
export interface ChatSandboxSession {
  /** Provisions or resumes the sandbox once. A failed start is kept, not retried per tool call. */
  readonly acquire: (
    report: (status: ChatSandboxStatus) => Effect.Effect<void>,
  ) => Effect.Effect<SandboxHandle, ChatSandboxUnavailable>
  /** Signs a download ticket for published bytes, scoped to the run's principal and provider. */
  readonly mintArtifactTicket: (
    artifact: Pick<
      SandboxArtifactTicket,
      "providerSandboxId" | "path" | "mimeType" | "size" | "sha256"
    >,
  ) => Effect.Effect<string>
}

export interface ChatArtifact {
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly path: string
}

interface ChatSandboxLease {
  readonly record: SandboxInstanceRecord
  /** Kept beside the record so eviction can destroy without re-reading credentials. */
  readonly provider: SandboxProvider
}

/**
 * Writes the run's attached files into the workspace as part of starting the sandbox. A failure
 * fails the start: an agent told a file is at `uploads/sales.csv` must not find it missing.
 */
function writeChatSandboxUploads(handle: SandboxHandle, uploads: readonly ChatAttachmentFile[]) {
  return Effect.gen(function* () {
    if (uploads.length === 0) return
    const directory = `${resolveHarnessCwd(handle)}/${CHAT_ATTACHMENT_UPLOAD_DIRECTORY}`
    // One level below a workspace that already exists, so this needs no recursive `mkdir`.
    yield* chatSandboxCall(() => handle.fs.mkdir(directory), CHAT_SANDBOX_FILE_TIMEOUT_MS)
    yield* Effect.forEach(
      uploads,
      (upload) =>
        chatSandboxCall(
          () => handle.fs.write(`${directory}/${upload.handle}`, upload.bytes),
          CHAT_SANDBOX_FILE_TIMEOUT_MS,
        ),
      { concurrency: "unbounded", discard: true },
    )
  })
}

export class ChatSandboxes extends Context.Service<
  ChatSandboxes,
  {
    /** Resolves the agent's stored provider into a run's session without provisioning anything. */
    readonly session: (input: {
      readonly sandboxProviderId: string
      readonly agentId: string
      readonly principal: ChatPrincipal
      readonly threadId: string
      readonly runId: string
      readonly uploads: readonly ChatAttachmentFile[]
    }) => Effect.Effect<ChatSandboxSession, ChatSandboxConfigurationUnreadable>
    /** Rereads exactly the bytes a ticket was minted for, resuming but never creating a sandbox. */
    readonly readArtifact: (ticket: string) => Effect.Effect<ChatArtifact, ChatArtifactUnavailable>
  }
>()("astralbeam/chat/ChatSandboxes") {
  static readonly layerNoDeps = Layer.effect(
    ChatSandboxes,
    Effect.gen(function* () {
      const providers = yield* SandboxProviders
      const artifactTicketKey = yield* Effect.cached(deriveArtifactTicketKey)
      // Process-local, so resume works only within one replica: a conversation that lands on
      // another instance starts a new sandbox instead, which costs time but is never incorrect.
      const leases = MutableHashMap.empty<string, ChatSandboxLease>()
      const destroys = yield* FiberSet.make()
      const sweeper = yield* FiberHandle.make()
      const runLeaseEffect = yield* FiberSet.makeRuntimePromise()

      const resolveProvider = (organizationId: string, id: string) =>
        providers
          .resolveConfiguration({ organizationId, id })
          .pipe(
            Effect.flatMap((configuration) =>
              createSandboxProvider(configuration.provider, configuration),
            ),
          )

      const destroyLease = (lease: ChatSandboxLease, timeout: Duration.Input) =>
        chatSandboxCall(
          (signal) => lease.provider.destroy({ id: lease.record.providerSandboxId, signal }),
          timeout,
        ).pipe(
          Effect.catch((error) => logChatSandboxFailure("destroy", error)),
          Effect.asVoid,
        )

      // The lease is forgotten before the destroy: a record pointing at a sandbox that is already
      // gone guarantees a failed resume, which is worse than an orphan the vendor reclaims.
      const releaseLease = (key: string) =>
        Effect.suspend(() => {
          const lease = MutableHashMap.get(leases, key)
          if (Option.isNone(lease)) return Effect.void
          MutableHashMap.remove(leases, key)
          return FiberSet.run(destroys, destroyLease(lease.value, CHAT_SANDBOX_FILE_TIMEOUT_MS))
        }).pipe(Effect.asVoid)

      const sweepIdleLeases = Effect.gen(function* () {
        const cutoff = (yield* Clock.currentTimeMillis) - CHAT_SANDBOX_IDLE_TTL_MS
        const idle = [...leases].filter(([, lease]) => lease.record.updatedAt <= cutoff)
        yield* Effect.forEach(idle, ([key]) => releaseLease(key), { discard: true })
        return MutableHashMap.size(leases)
      })

      const upsertLease = (key: string, lease: ChatSandboxLease) =>
        Effect.gen(function* () {
          // Reinserting keeps the map in least recently used order, which the cap evicts from:
          // a burst of conversations would otherwise hold as many billed sandboxes as threads.
          MutableHashMap.remove(leases, key)
          MutableHashMap.set(leases, key, lease)
          const excess = [...leases].slice(
            0,
            Math.max(0, MutableHashMap.size(leases) - CHAT_SANDBOX_MAX_LIVE),
          )
          yield* Effect.forEach(excess, ([evicted]) => releaseLease(evicted), { discard: true })
          // The sweep runs only while a sandbox is live, so an idle deployment holds no timer.
          yield* FiberHandle.run(
            sweeper,
            sweepIdleLeases.pipe(
              Effect.delay(CHAT_SANDBOX_SWEEP_INTERVAL_MS),
              Effect.repeat({ while: (live) => live > 0 }),
            ),
            { onlyIfMissing: true },
          )
        })

      // `computeSandboxKey` is a 64-bit hash over a browser-supplied `threadId`, so lookups are
      // also namespaced by the verified principal, confining a forged thread to its own sandboxes.
      const instanceStore = (scope: string, provider: SandboxProvider): SandboxInstanceStore => {
        const scoped = (key: string) => `${scope}\0${key}`
        return {
          get: (key) =>
            Promise.resolve(
              Option.getOrNull(
                Option.map(MutableHashMap.get(leases, scoped(key)), (lease) => lease.record),
              ),
            ),
          upsert: (record) => runLeaseEffect(upsertLease(scoped(record.key), { record, provider })),
          delete: (key) => Promise.resolve(void MutableHashMap.remove(leases, scoped(key))),
        }
      }

      // Leases outlive runs but not the process: shutdown and module reloads destroy them all.
      yield* Effect.addFinalizer(() =>
        Effect.all(
          [
            Effect.forEach(
              [...leases],
              ([key, lease]) => {
                MutableHashMap.remove(leases, key)
                return destroyLease(lease, CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS)
              },
              { concurrency: "unbounded", discard: true },
            ),
            FiberSet.awaitEmpty(destroys),
          ],
          { concurrency: 2, discard: true },
        ).pipe(Effect.timeoutOption(CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS)),
      )

      const session = Effect.fn("ChatSandboxes.session")(
        function* (input: {
          sandboxProviderId: string
          agentId: string
          principal: ChatPrincipal
          threadId: string
          runId: string
          uploads: readonly ChatAttachmentFile[]
        }) {
          const organizationId = input.principal.organization.id
          const provider = yield* resolveProvider(organizationId, input.sandboxProviderId)
          // The agent is part of the sandbox identity, so switching a thread to another agent
          // starts a clean sandbox rather than resuming one provisioned for other instructions.
          const definition = defineSandbox({
            id: `${APP_HANDLE}-chat-${input.agentId}`,
            provider,
            // No snapshot: the workspace is empty until the agent writes to it, so an after-setup
            // snapshot would cost a round trip per create and restore nothing worth restoring.
            lifecycle: { reuse: "thread", snapshot: "none" },
          })
          const principalScope = chatPrincipalScope(input.principal)
          const ensureContext = {
            threadId: input.threadId,
            runId: input.runId,
            tenant: { orgId: organizationId, userId: principalScope },
            store: instanceStore(principalScope, provider),
          }
          const started = yield* Deferred.make<SandboxHandle, ChatSandboxUnavailable>()
          const claimed = yield* Ref.make(false)

          const start = (report: (status: ChatSandboxStatus) => Effect.Effect<void>) =>
            Effect.gen(function* () {
              // `ensure` is the whole resume-or-create algorithm and the slowest step of a
              // sandboxed run, which is why the status event goes out before it.
              yield* report({ state: "starting" })
              const handle = yield* chatSandboxCall(
                (signal) => definition.ensure({ ...ensureContext, signal }),
                CHAT_SANDBOX_START_TIMEOUT_MS,
              )
              yield* writeChatSandboxUploads(handle, input.uploads)
              yield* report({ state: "ready" })
              return handle
            }).pipe(
              Effect.catch((error) =>
                logChatSandboxFailure("start", error).pipe(
                  Effect.andThen(report({ state: "error" })),
                  Effect.andThen(Effect.fail(new ChatSandboxUnavailable())),
                ),
              ),
            )

          return {
            // Provisioning is the slowest step of a run, so a failure is kept rather than spent
            // again on every later tool call.
            acquire: (report) =>
              Effect.flatMap(Ref.getAndSet(claimed, true), (alreadyClaimed) =>
                alreadyClaimed
                  ? Deferred.await(started)
                  : start(report).pipe(
                      Deferred.into(started),
                      Effect.andThen(Deferred.await(started)),
                    ),
              ),
            mintArtifactTicket: (artifact) =>
              Effect.flatMap(artifactTicketKey, (key) =>
                mintSandboxArtifactTicket(key, {
                  ...artifact,
                  organizationId,
                  tenantId: input.principal.tenantUser.tenant.id,
                  tenantUserId: input.principal.tenantUser.id,
                  sandboxProviderId: input.sandboxProviderId,
                }),
              ),
          } satisfies ChatSandboxSession
        },
        Effect.tapError((error) =>
          Effect.logWarning("Chat sandbox configuration could not be read").pipe(
            Effect.annotateLogs({ reason: errorReason(error) }),
          ),
        ),
        Effect.mapError(() => new ChatSandboxConfigurationUnreadable()),
      )

      const readArtifact = Effect.fn("ChatSandboxes.readArtifact")(function* (token: string) {
        const ticket = yield* verifySandboxArtifactTicket(yield* artifactTicketKey, token)
        // Provider and file-read failures are unexpected here and surface as a 500.
        const provider = yield* resolveProvider(
          ticket.organizationId,
          ticket.sandboxProviderId,
        ).pipe(Effect.orDie)
        const handle = yield* chatSandboxCall(
          (signal) => provider.resume({ id: ticket.providerSandboxId, signal }),
          CHAT_SANDBOX_FILE_TIMEOUT_MS,
        ).pipe(Effect.orDie)
        if (!handle) return yield* new ChatArtifactUnavailable({ reason: "SandboxGone" })
        // The path was containment-checked at publish time, so recheck it against the resumed
        // workspace so a root that moved cannot turn it into an escape.
        const resolved = resolveSandboxPath(resolveHarnessCwd(handle), ticket.path)
        if ("refusal" in resolved || resolved.path !== ticket.path) {
          return yield* new ChatArtifactUnavailable({ reason: "Moved" })
        }
        const bytes = yield* chatSandboxCall(
          () => handle.fs.readBytes(resolved.path),
          CHAT_SANDBOX_FILE_TIMEOUT_MS,
        ).pipe(Effect.orDie)
        if (bytes.byteLength > CHAT_SANDBOX_MAX_ARTIFACT_BYTES) {
          return yield* new ChatArtifactUnavailable({ reason: "TooLarge" })
        }
        // The capability covers exactly the published bytes: a same-type overwrite must be
        // republished, so the digest decides and the sniff is rerun for the response header.
        const mimeType = detectSandboxArtifactMimeType(bytes)
        if (
          (yield* artifactContentDigest(bytes)) !== ticket.sha256 ||
          mimeType !== ticket.mimeType
        ) {
          return yield* new ChatArtifactUnavailable({ reason: "Changed" })
        }
        return { bytes, mimeType, path: resolved.path }
      })

      return ChatSandboxes.of({ session, readArtifact })
    }),
  )

  static readonly layer = ChatSandboxes.layerNoDeps.pipe(Layer.provide(SandboxProviders.layer))
}
