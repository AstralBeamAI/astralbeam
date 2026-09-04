import {
  defineSandbox,
  resolveHarnessCwd,
  type SandboxDefinition,
  type SandboxEnsureContext,
  type SandboxHandle,
  type SandboxInstanceRecord,
  type SandboxInstanceStore,
  type SandboxProvider,
} from "@tanstack/ai-sandbox"
import * as Effect from "effect/Effect"

import { resolveOrganizationSandboxProviderConfiguration } from "@/db/organization-sandbox-provider.server"
import { APP_HANDLE } from "@/lib/constants"
import { createSandboxProvider } from "@/lib/sandbox/factory.server"
import {
  CHAT_ATTACHMENT_UPLOAD_DIRECTORY,
  CHAT_SANDBOX_FILE_TIMEOUT_MS,
  CHAT_SANDBOX_IDLE_TTL_MS,
  CHAT_SANDBOX_MAX_LIVE,
  CHAT_SANDBOX_START_TIMEOUT_MS,
  CHAT_SANDBOX_SWEEP_INTERVAL_MS,
} from "./constants.server"
import { chatPrincipalScope } from "./identity.server"
import type { ChatAttachmentFile, ChatPrincipal, ChatSandboxStatus } from "./types"

/**
 * Sandbox lifecycle for one chat run.
 *
 * Everything downstream of the database read is Promise-shaped upstream — TanStack's
 * `SandboxHandle`, the sandbox definition's `ensure`, and the tool `execute` contract this feeds —
 * so this module is the boundary itself and stays async/await. Only the provider configuration
 * read, which composes with the database's Effect runtime, is an Effect program.
 *
 * A sandbox is NOT provisioned when a run starts: `acquireChatSandbox` is called by the first
 * sandbox tool the agent reaches for, so an ordinary reply costs nothing. `reuse: "thread"` then
 * keeps that sandbox for the rest of the conversation, which is what lets the agent build on the
 * files it already wrote.
 */

/** Per-run state; `handle` memoizes the one `ensure` so several tool calls share one sandbox. */
export interface ChatSandboxSession {
  readonly definition: SandboxDefinition
  readonly ensureContext: SandboxEnsureContext
  /** Files the user attached, written into the workspace as part of starting the sandbox. */
  readonly uploads: readonly ChatAttachmentFile[]
  handle?: Promise<SandboxHandle>
}

interface ChatSandboxLease {
  record: SandboxInstanceRecord
  /** Kept live beside the record so the idle sweep can destroy without re-reading credentials. */
  provider: SandboxProvider
}

// Process-lifetime state. Resume therefore works only within one replica: a conversation that
// lands on another instance starts a new sandbox instead of resuming, which costs provisioning
// time but is never incorrect. A durable `SandboxInstanceStore` is the documented upgrade path.
const chatSandboxLeases = new Map<string, ChatSandboxLease>()
let chatSandboxSweepTimer: ReturnType<typeof setInterval> | undefined

/** Replaces the vendor's own error, which can carry hostnames or credentials, before it escapes. */
class ChatSandboxUnavailableError extends Error {
  override readonly name = "ChatSandboxUnavailableError"
}

/**
 * Resolve the agent's stored provider into a per-run session, or fail when the configuration is
 * gone or unreadable. The read is organization-scoped by `resolveOrganizationSandboxProviderConfiguration`.
 */
export function resolveChatSandboxSession(input: {
  readonly sandboxProviderId: string
  readonly agentId: string
  readonly principal: ChatPrincipal
  readonly threadId: string
  readonly runId: string
  readonly uploads: readonly ChatAttachmentFile[]
}) {
  return Effect.gen(function* () {
    const configuration = yield* resolveOrganizationSandboxProviderConfiguration(
      input.principal.organization.id,
      input.sandboxProviderId,
    )
    const provider = yield* createSandboxProvider(configuration.provider, configuration)
    // The agent is part of the sandbox identity, so switching a thread to another agent starts a
    // clean sandbox rather than resuming one provisioned for different instructions.
    const definition = defineSandbox({
      id: `${APP_HANDLE}-chat-${input.agentId}`,
      provider,
      // No snapshot: the workspace is empty until the agent writes to it, so an after-setup
      // snapshot would cost a round trip per create and restore nothing worth restoring.
      lifecycle: { reuse: "thread", snapshot: "none" },
    })
    const principalScope = chatPrincipalScope(input.principal)
    const tenant = {
      orgId: input.principal.organization.id,
      userId: principalScope,
    }
    return {
      definition,
      uploads: input.uploads,
      ensureContext: {
        threadId: input.threadId,
        runId: input.runId,
        tenant,
        store: chatSandboxInstanceStore({
          scope: principalScope,
          provider,
        }),
      },
    }
  })
}

/** Provision or resume the run's sandbox. Idempotent per session, including after a failure. */
export function acquireChatSandbox(
  session: ChatSandboxSession,
  onStatus: (status: ChatSandboxStatus) => void,
): Promise<SandboxHandle> {
  // A rejected promise is deliberately kept: provisioning is the slowest step in the run, and
  // retrying it once per tool call would spend minutes re-failing the same way.
  session.handle ??= startChatSandbox(session, onStatus)
  return session.handle
}

async function startChatSandbox(
  session: ChatSandboxSession,
  onStatus: (status: ChatSandboxStatus) => void,
): Promise<SandboxHandle> {
  onStatus({ state: "starting" })
  try {
    // `ensure` is the whole resume-or-restore-or-create algorithm; it is also the slowest thing
    // in a sandboxed run, which is why the status event goes out before it and not after.
    const handle = await session.definition.ensure({
      ...session.ensureContext,
      signal: AbortSignal.timeout(CHAT_SANDBOX_START_TIMEOUT_MS),
    })
    await writeChatSandboxUploads(handle, session.uploads)
    onStatus({ state: "ready" })
    return handle
  } catch (error) {
    console.error("Failed to start the /api/chat sandbox:", error)
    onStatus({ state: "error" })
    throw new ChatSandboxUnavailableError("The sandbox could not be started")
  }
}

/**
 * Writes the run's attached files into the workspace, as part of starting the sandbox rather than
 * as a step the agent has to take. Provisioning is lazy, so a conversation that only reads its
 * file cards never pays for this; by the time any sandbox tool runs, the files are already there.
 *
 * A rejection propagates and fails the start: an agent told a file is at `uploads/sales.csv` must
 * not find it missing, and a refusal it can relay is better than a silent absence it cannot.
 */
async function writeChatSandboxUploads(
  handle: SandboxHandle,
  uploads: readonly ChatAttachmentFile[],
): Promise<void> {
  if (uploads.length === 0) return
  const directory = `${resolveHarnessCwd(handle)}/${CHAT_ATTACHMENT_UPLOAD_DIRECTORY}`
  // One level below a workspace that already exists, so this needs no recursive `mkdir`.
  await requireSandboxOperation(handle.fs.mkdir(directory), CHAT_SANDBOX_FILE_TIMEOUT_MS)
  await Promise.all(uploads.map((upload) =>
    requireSandboxOperation(
      handle.fs.write(`${directory}/${upload.handle}`, upload.bytes),
      CHAT_SANDBOX_FILE_TIMEOUT_MS,
    )
  ))
}

const SANDBOX_TIMEOUT = Symbol("sandbox-timeout")

export async function withSandboxTimeout<Value>(
  operation: Promise<Value>,
  ms: number,
): Promise<Value | typeof SANDBOX_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<typeof SANDBOX_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(SANDBOX_TIMEOUT), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function isSandboxTimeout(value: unknown): value is typeof SANDBOX_TIMEOUT {
  return value === SANDBOX_TIMEOUT
}

/** For the filesystem calls, where a timeout means the sandbox itself stopped answering. */
export async function requireSandboxOperation<Value>(
  operation: Promise<Value>,
  ms: number,
): Promise<Value> {
  const result = await withSandboxTimeout(operation, ms)
  if (isSandboxTimeout(result)) throw new Error("The sandbox did not respond in time")
  return result
}

/**
 * Instance store namespaced by the authenticated principal.
 *
 * `computeSandboxKey` already folds the tenant in, but it is a 64-bit FNV-1a hash and `threadId`
 * is browser-supplied, so the key alone is not a tenant boundary. Namespacing every lookup with
 * an organization, tenant, and tenant-user scope taken from the verified token means a forged or
 * colliding thread can only ever reach that principal's own sandboxes.
 */
function chatSandboxInstanceStore(
  input: { readonly scope: string; readonly provider: SandboxProvider },
): SandboxInstanceStore {
  const scoped = (key: string) => `${input.scope}\0${key}`
  return {
    get: (key) => Promise.resolve(chatSandboxLeases.get(scoped(key))?.record ?? null),
    upsert: (record) => {
      chatSandboxLeases.set(scoped(record.key), { record, provider: input.provider })
      startChatSandboxSweep()
      evictExcessChatSandboxes()
      return Promise.resolve()
    },
    delete: (key) => {
      chatSandboxLeases.delete(scoped(key))
      return Promise.resolve()
    },
  }
}

/** Destroy sandboxes nobody has used for {@link CHAT_SANDBOX_IDLE_TTL_MS}. */
async function sweepIdleChatSandboxes(): Promise<void> {
  const cutoff = Date.now() - CHAT_SANDBOX_IDLE_TTL_MS
  await Promise.all(
    [...chatSandboxLeases].filter(([, lease]) => lease.record.updatedAt <= cutoff).map((
      [key],
    ) => destroyChatSandboxLease(key)),
  )
  if (chatSandboxLeases.size === 0 && chatSandboxSweepTimer !== undefined) {
    clearInterval(chatSandboxSweepTimer)
    chatSandboxSweepTimer = undefined
  }
}

// The cap is the guard the TTL cannot give: a burst of conversations would otherwise hold as many
// billed sandboxes as it had threads. The least recently used goes first.
function evictExcessChatSandboxes(): void {
  if (chatSandboxLeases.size <= CHAT_SANDBOX_MAX_LIVE) return
  const byAge = [...chatSandboxLeases].sort((
    [, first],
    [, second],
  ) => first.record.updatedAt - second.record.updatedAt)
  for (const [key] of byAge.slice(0, chatSandboxLeases.size - CHAT_SANDBOX_MAX_LIVE)) {
    // Not awaited: a destroy is a vendor round trip, and the run that triggered the eviction is
    // not the one that should wait for it.
    void destroyChatSandboxLease(key)
  }
}

/**
 * Forget the lease before asking the vendor to destroy it. A record pointing at a sandbox that is
 * already gone guarantees a failed resume on the thread's next turn, which is worse than an
 * orphaned sandbox the vendor itself reclaims.
 */
async function destroyChatSandboxLease(key: string): Promise<void> {
  const lease = chatSandboxLeases.get(key)
  if (!lease) return
  chatSandboxLeases.delete(key)
  try {
    await lease.provider.destroy({ id: lease.record.providerSandboxId })
  } catch (error) {
    console.error("Failed to destroy an idle /api/chat sandbox:", error)
  }
}

// Only runs while at least one sandbox is live, and stops itself once the last one is gone, so an
// idle deployment holds no timer.
function startChatSandboxSweep(): void {
  if (chatSandboxSweepTimer !== undefined) return
  chatSandboxSweepTimer = setInterval(() => {
    void sweepIdleChatSandboxes()
  }, CHAT_SANDBOX_SWEEP_INTERVAL_MS)
}
