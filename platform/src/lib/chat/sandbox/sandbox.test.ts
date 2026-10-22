import { assert, describe, it } from "@effect/vitest"
import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scheduler, Scope } from "effect"
import { TestClock } from "effect/testing"
import { beforeEach } from "vitest"

import { SandboxProviderFactory } from "@/lib/sandboxes/factory.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import {
  CHAT_SANDBOX_IDLE_TTL_MS,
  CHAT_SANDBOX_MAX_LIVE,
  CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS,
  CHAT_SANDBOX_SWEEP_INTERVAL_MS,
} from "./constants.ts"
import { ChatSandboxes, type ChatSandboxStatus } from "./sandbox.ts"

function freshChatSandboxTestState() {
  return {
    created: 0,
    createFails: false,
    destroyFails: false,
    destroyed: [] as string[],
    createGate: undefined as Promise<void> | undefined,
    createStarted: undefined as Deferred.Deferred<void> | undefined,
    destroyGate: undefined as Promise<void> | undefined,
    destroyStarted: undefined as Deferred.Deferred<void> | undefined,
    destroySignal: undefined as AbortSignal | undefined,
  }
}

let sandboxTest = freshChatSandboxTestState()

function fakeSandboxHandle(id: string): SandboxHandle {
  return { id, provider: "fake", workspaceRoot: "/workspace" } as SandboxHandle
}

const fakeSandboxProvider = {
  name: "fake",
  capabilities: () => ({ snapshots: false }),
  create: async () => {
    const id = `sandbox-${++sandboxTest.created}`
    if (sandboxTest.createStarted) Deferred.doneUnsafe(sandboxTest.createStarted, Effect.void)
    if (sandboxTest.createFails) throw new Error("vendor detail: token sk-secret")
    await sandboxTest.createGate
    return fakeSandboxHandle(id)
  },
  resume: ({ id }: { id: string }) => Promise.resolve(fakeSandboxHandle(id)),
  destroy: async ({ id, signal }: { id: string; signal?: AbortSignal }) => {
    sandboxTest.destroyed.push(id)
    sandboxTest.destroySignal = signal
    if (sandboxTest.destroyStarted) Deferred.doneUnsafe(sandboxTest.destroyStarted, Effect.void)
    if (sandboxTest.destroyFails) throw new Error("provider unavailable")
    await sandboxTest.destroyGate
  },
} as unknown as SandboxProvider

const sandboxesLayer = ChatSandboxes.layerNoDeps.pipe(
  Layer.provide([
    Layer.succeed(SandboxProviders, {
      resolveConfiguration: () =>
        Effect.succeed({ name: "Local", provider: "docker", options: {}, credentials: {} }),
    } as unknown as SandboxProviders["Service"]),
    Layer.succeed(SandboxProviderFactory, { create: () => Effect.succeed(fakeSandboxProvider) }),
  ]),
)

const principal = {
  organization: { id: "01990a5d-ac96-774b-b942-6b13c85384ca" },
  tenantUser: { id: "user", tenant: { id: "tenant" } },
}

function sessionFor(
  sandboxes: ChatSandboxes["Service"],
  input: Partial<Parameters<ChatSandboxes["Service"]["session"]>[0]> = {},
) {
  return sandboxes.session({
    sandboxProviderId: "01990a5d-ac96-774b-b942-6b13c85384cc",
    agentId: "01990a5d-ac96-774b-b942-6b13c85384cb",
    principal,
    threadId: "thread",
    runId: "run",
    uploads: [],
    ...input,
  })
}

const noStatus = () => Effect.void

function acquireFor(
  sandboxes: ChatSandboxes["Service"],
  input: Parameters<typeof sessionFor>[1] = {},
) {
  return sessionFor(sandboxes, input).pipe(Effect.flatMap((session) => session.acquire(noStatus)))
}

beforeEach(() => {
  sandboxTest = freshChatSandboxTestState()
})

describe("ChatSandboxes", () => {
  it.effect("starts a run's sandbox once and keeps a failed start for later tool calls", () =>
    Effect.gen(function* () {
      sandboxTest.createFails = true
      const session = yield* sessionFor(yield* ChatSandboxes)
      const statuses: ChatSandboxStatus[] = []
      const report = (status: ChatSandboxStatus) => Effect.sync(() => statuses.push(status))
      const first = yield* Effect.flip(session.acquire(report))
      const second = yield* Effect.flip(session.acquire(report))
      assert.strictEqual(first._tag, "ChatSandboxUnavailable")
      assert.strictEqual(second._tag, "ChatSandboxUnavailable")
      assert.notInclude(first.message, "sk-secret")
      assert.strictEqual(sandboxTest.created, 1)
      assert.deepStrictEqual(statuses, [{ state: "starting" }, { state: "error" }])
    }).pipe(Effect.scoped, Effect.provide(sandboxesLayer)),
  )

  it.effect("shuts down every sandbox once while an idle deletion is still in flight", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope)
      const context = yield* Layer.buildWithScope(sandboxesLayer, scope)
      const sandboxes = Context.get(context, ChatSandboxes)
      yield* acquireFor(sandboxes, { threadId: "idle" }).pipe(Effect.scoped)
      yield* acquireFor(sandboxes)
      const destroy = Promise.withResolvers<void>()
      sandboxTest.destroyGate = destroy.promise
      sandboxTest.destroyStarted = yield* Deferred.make<void>()
      yield* TestClock.adjust(CHAT_SANDBOX_IDLE_TTL_MS)
      yield* Deferred.await(sandboxTest.destroyStarted)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1"])
      const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
      yield* TestClock.adjust(CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS)
      yield* Fiber.join(closing)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1", "sandbox-2"])
      destroy.resolve()
      yield* Effect.yieldNow
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1", "sandbox-2"])
    }).pipe(Effect.scoped),
  )

  it.effect("refuses a start when shutdown wins the scheduling race", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Effect.scope)
      const context = yield* Layer.buildWithScope(sandboxesLayer, scope)
      const caller = yield* Effect.withFiber(Effect.succeed)
      const closed = yield* Deferred.make<void>()
      const scheduler = new Scheduler.MixedScheduler()
      let shuttingDown = false
      scheduler.shouldYield = (fiber) => {
        if (fiber === caller || shuttingDown) return false
        shuttingDown = true
        Effect.runFork(
          Scope.close(scope, Exit.void).pipe(Effect.andThen(Deferred.succeed(closed, undefined))),
        )
        return true
      }
      const result = yield* acquireFor(Context.get(context, ChatSandboxes)).pipe(
        Effect.provideService(Scheduler.Scheduler, scheduler),
        Effect.exit,
      )
      yield* Deferred.await(closed)
      assert.deepStrictEqual(
        {
          failed: Exit.isFailure(result),
          created: sandboxTest.created,
          destroyed: sandboxTest.destroyed,
        },
        { failed: true, created: 0, destroyed: [] },
      )
    }).pipe(Effect.scoped),
  )

  it.effect("finishes destroying the oldest idle sandbox before provisioning beyond the cap", () =>
    Effect.gen(function* () {
      const sandboxes = yield* ChatSandboxes
      for (let thread = 0; thread < CHAT_SANDBOX_MAX_LIVE; thread += 1) {
        yield* acquireFor(sandboxes, { threadId: `thread-${thread}` }).pipe(Effect.scoped)
      }
      yield* TestClock.adjust(1)
      yield* acquireFor(sandboxes, { threadId: "thread-0" }).pipe(Effect.scoped)
      sandboxTest.destroyFails = true
      assert.strictEqual(
        (yield* Effect.flip(acquireFor(sandboxes, { threadId: "new-thread" })))._tag,
        "ChatSandboxUnavailable",
      )
      assert.strictEqual(sandboxTest.created, CHAT_SANDBOX_MAX_LIVE)
      sandboxTest.destroyFails = false
      sandboxTest.destroyed = []
      const destroy = Promise.withResolvers<void>()
      sandboxTest.destroyGate = destroy.promise
      sandboxTest.destroyStarted = yield* Deferred.make<void>()
      const next = yield* acquireFor(sandboxes, { threadId: "new-thread" }).pipe(Effect.forkChild)
      yield* Deferred.await(sandboxTest.destroyStarted)
      yield* Fiber.interrupt(next)
      assert.isFalse(sandboxTest.destroySignal?.aborted)
      const replacement = yield* acquireFor(sandboxes, { threadId: "new-thread" }).pipe(
        Effect.forkChild,
      )
      yield* Effect.yieldNow
      assert.strictEqual(sandboxTest.created, CHAT_SANDBOX_MAX_LIVE)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-2"])
      destroy.resolve()
      yield* Fiber.join(replacement)
      assert.strictEqual(sandboxTest.created, CHAT_SANDBOX_MAX_LIVE + 1)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-2"])
    }).pipe(Effect.scoped, Effect.provide(sandboxesLayer)),
  )

  it.effect(
    "reserves in-flight capacity through cancellation and destroys a late sandbox once",
    () =>
      Effect.gen(function* () {
        const sandboxes = yield* ChatSandboxes
        for (let thread = 0; thread < CHAT_SANDBOX_MAX_LIVE - 1; thread += 1) {
          yield* acquireFor(sandboxes, { threadId: `thread-${thread}` })
        }
        const create = Promise.withResolvers<void>()
        sandboxTest.createGate = create.promise
        sandboxTest.createStarted = yield* Deferred.make<void>()
        const pending = yield* acquireFor(sandboxes, { threadId: "pending" }).pipe(
          Effect.scoped,
          Effect.forkChild,
        )
        yield* Deferred.await(sandboxTest.createStarted)
        yield* Fiber.interrupt(pending)
        assert.strictEqual(
          (yield* Effect.flip(acquireFor(sandboxes, { threadId: "after-cancel" })))._tag,
          "ChatSandboxUnavailable",
        )
        assert.strictEqual(sandboxTest.created, CHAT_SANDBOX_MAX_LIVE)
        sandboxTest.destroyStarted = yield* Deferred.make<void>()
        sandboxTest.createGate = undefined
        create.resolve()
        yield* Deferred.await(sandboxTest.destroyStarted)
        yield* Effect.yieldNow
        yield* acquireFor(sandboxes, { threadId: "replacement" })
        assert.strictEqual(sandboxTest.created, CHAT_SANDBOX_MAX_LIVE + 1)
        yield* TestClock.adjust(CHAT_SANDBOX_IDLE_TTL_MS + CHAT_SANDBOX_SWEEP_INTERVAL_MS)
        assert.deepStrictEqual(sandboxTest.destroyed, [`sandbox-${CHAT_SANDBOX_MAX_LIVE}`])
      }).pipe(Effect.scoped, Effect.provide(sandboxesLayer)),
  )

  it.effect("keeps active runs alive and retries failed cleanup after idle expiry", () =>
    Effect.gen(function* () {
      const sandboxes = yield* ChatSandboxes
      const firstScope = yield* Scope.fork(yield* Effect.scope)
      const secondScope = yield* Scope.fork(yield* Effect.scope)
      const first = yield* acquireFor(sandboxes, { runId: "first" }).pipe(Scope.provide(firstScope))
      const second = yield* acquireFor(sandboxes, { runId: "second" }).pipe(
        Scope.provide(secondScope),
      )
      assert.strictEqual(first.id, second.id)
      yield* Scope.close(firstScope, Exit.void)
      yield* TestClock.adjust(CHAT_SANDBOX_IDLE_TTL_MS + CHAT_SANDBOX_SWEEP_INTERVAL_MS)
      assert.deepStrictEqual(sandboxTest.destroyed, [])
      yield* Scope.close(secondScope, Exit.void)
      yield* TestClock.adjust(CHAT_SANDBOX_IDLE_TTL_MS - CHAT_SANDBOX_SWEEP_INTERVAL_MS)
      assert.deepStrictEqual(sandboxTest.destroyed, [])
      sandboxTest.destroyFails = true
      yield* TestClock.adjust(2 * CHAT_SANDBOX_SWEEP_INTERVAL_MS)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1"])
      sandboxTest.destroyFails = false
      yield* TestClock.adjust(CHAT_SANDBOX_SWEEP_INTERVAL_MS)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1", "sandbox-1"])
      yield* TestClock.adjust(CHAT_SANDBOX_IDLE_TTL_MS)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1", "sandbox-1"])
    }).pipe(Effect.scoped, Effect.provide(sandboxesLayer)),
  )

  it.effect(
    "reuses one identity while isolating provider configurations and every principal key",
    () =>
      Effect.gen(function* () {
        const sandboxes = yield* ChatSandboxes
        const acquire = (input: Parameters<typeof sessionFor>[1] = {}) =>
          acquireFor(sandboxes, input).pipe(Effect.scoped)
        assert.strictEqual((yield* acquire()).id, (yield* acquire()).id)
        for (const input of [
          { sandboxProviderId: "01990a5d-ac96-774b-b942-6b13c85384dd" },
          {
            principal: {
              ...principal,
              organization: { id: "01990a5d-ac96-774b-b942-6b13c85384da" },
            },
          },
          {
            principal: { ...principal, tenantUser: { id: "other-user", tenant: { id: "tenant" } } },
          },
          {
            principal: { ...principal, tenantUser: { id: "user", tenant: { id: "other-tenant" } } },
          },
        ]) {
          assert.notStrictEqual((yield* acquire(input)).id, "sandbox-1")
        }
        assert.strictEqual(sandboxTest.created, 5)
      }).pipe(Effect.provide(sandboxesLayer)),
  )
})
