import { defineSandbox, resolveHarnessCwd, type SandboxHandle } from "@tanstack/ai-sandbox"
import { Context, Deferred, Effect, Exit, Layer, Option, Ref, Scope } from "effect"

import { APP_HANDLE } from "@/lib/constants"
import { errorReason } from "@/lib/runtime/failure-report.server"
import { SandboxProviderFactory } from "@/lib/sandboxes/factory.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { CHAT_ATTACHMENT_UPLOAD_DIRECTORY } from "../attachments/constants"
import { CHAT_SANDBOX_FILE_TIMEOUT_MS } from "./constants"
import { makeChatSandboxLeases } from "./leases"
import { chatSandboxCall, logChatSandboxFailure } from "./operations"
import { ChatSandboxConfigurationUnreadable, ChatSandboxUnavailable } from "./errors.ts"
import { chatPrincipalScope } from "../identity"
import type { ChatAttachmentFile } from "../attachments/types"
import type { ChatPrincipal } from "../types"

/** CUSTOM events show provisioning progress before a tool can return its result. */
export type ChatSandboxStatus = { readonly state: "starting" | "ready" | "error" }

/** One run's sandbox, provisioned on first use and shared by every tool call after it. */
export interface ChatSandboxSession {
  /** Provisions or resumes the sandbox once. A failed start is kept, not retried per tool call. */
  readonly acquire: (
    report: (status: ChatSandboxStatus) => Effect.Effect<void>,
  ) => Effect.Effect<SandboxHandle, ChatSandboxUnavailable>
  /** Refreshes uploads before a model phase without provisioning an unused sandbox. */
  readonly prepareUploads: (
    files: readonly ChatAttachmentFile[],
  ) => Effect.Effect<void, ChatSandboxUnavailable>
}

/** Upload failures fail startup so the agent never receives a workspace missing its attachments. */
const writeChatSandboxUploads = Effect.fn("writeChatSandboxUploads")(function* (
  handle: SandboxHandle,
  uploads: readonly ChatAttachmentFile[],
) {
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

interface ChatSandboxSessionInput {
  readonly sandboxProviderId: string
  readonly agentId: string
  readonly principal: ChatPrincipal
  readonly threadId: string
  readonly runId: string
  readonly uploads: readonly ChatAttachmentFile[]
}

export class ChatSandboxes extends Context.Service<
  ChatSandboxes,
  {
    /** Resolves the agent's stored provider into a run's session without provisioning anything. */
    readonly session: (
      input: ChatSandboxSessionInput,
    ) => Effect.Effect<ChatSandboxSession, ChatSandboxConfigurationUnreadable, Scope.Scope>
  }
>()("astralbeam/chat/ChatSandboxes") {
  static readonly layerNoDeps = Layer.effect(
    ChatSandboxes,
    Effect.gen(function* () {
      const providers = yield* SandboxProviders
      const factory = yield* SandboxProviderFactory
      const acquireSandbox = yield* makeChatSandboxLeases

      const session = Effect.fn("ChatSandboxes.session")(
        function* (input: ChatSandboxSessionInput) {
          const organizationId = input.principal.organization.id
          const configuration = yield* providers.resolveConfiguration({
            organizationId,
            id: input.sandboxProviderId,
          })
          const provider = yield* factory.create(configuration.provider, configuration)
          const scope = yield* Scope.fork(yield* Effect.scope)
          const definition = defineSandbox({
            id: `${APP_HANDLE}-chat-${input.agentId}-${input.sandboxProviderId}`,
            provider,
            // No snapshot: the workspace is empty until the agent writes to it, so an after-setup
            // snapshot would cost a round trip per create and restore nothing worth restoring.
            lifecycle: { reuse: "thread", snapshot: "none" },
          })
          const principalScope = chatPrincipalScope(input.principal)
          const context = {
            threadId: input.threadId,
            runId: input.runId,
            tenant: { orgId: organizationId, userId: principalScope },
          }
          // The upstream key is a 64-bit hash over a browser-supplied threadId, not a tenant boundary.
          const key = `${principalScope}\0${definition.key(context)}`
          const started = yield* Deferred.make<SandboxHandle, ChatSandboxUnavailable>()
          const claimed = yield* Ref.make(false)
          const uploads = yield* Ref.make(input.uploads)
          const uploaded = new Set<string>()

          const start = (report: (status: ChatSandboxStatus) => Effect.Effect<void>) =>
            Effect.gen(function* () {
              // `ensure` is the whole resume-or-create algorithm and the slowest step of a
              // sandboxed run, which is why the status event goes out before it.
              yield* report({ state: "starting" })
              const handle = yield* acquireSandbox({ key, definition, context }).pipe(
                Scope.provide(scope),
              )
              const files = yield* Ref.get(uploads)
              yield* writeChatSandboxUploads(handle, files)
              for (const file of files) uploaded.add(file.handle)
              yield* report({ state: "ready" })
              return handle
            }).pipe(
              Effect.onError(() => Scope.close(scope, Exit.void)),
              Effect.tapErrorTag("ChatSandboxOperationFailed", (error) =>
                logChatSandboxFailure("start", error),
              ),
              Effect.tapError(() => report({ state: "error" })),
              Effect.mapError(() => new ChatSandboxUnavailable()),
            )

          return {
            acquire: (report) =>
              Effect.flatMap(Ref.getAndSet(claimed, true), (alreadyClaimed) =>
                alreadyClaimed
                  ? Deferred.await(started)
                  : start(report).pipe(Effect.onExit((exit) => Deferred.done(started, exit))),
              ),
            prepareUploads: (files) =>
              Effect.gen(function* () {
                yield* Ref.set(uploads, files)
                const handle = yield* Deferred.poll(started)
                if (Option.isNone(handle)) return
                const running = yield* handle.value
                const additions = files.filter((file) => !uploaded.has(file.handle))
                yield* writeChatSandboxUploads(running, additions)
                for (const file of additions) uploaded.add(file.handle)
              }).pipe(Effect.mapError(() => new ChatSandboxUnavailable())),
          } satisfies ChatSandboxSession
        },
        Effect.tapError((error) =>
          Effect.logWarning("Chat sandbox configuration could not be read").pipe(
            Effect.annotateLogs({ reason: errorReason(error) }),
          ),
        ),
        Effect.mapError(() => new ChatSandboxConfigurationUnreadable()),
      )

      return ChatSandboxes.of({ session })
    }),
  )

  static readonly layer = ChatSandboxes.layerNoDeps.pipe(
    Layer.provide([SandboxProviders.layer, SandboxProviderFactory.layer]),
  )
}
