import { assert, describe, it } from "@effect/vitest"
import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"
import { Context, Effect, Exit, Layer, Scope } from "effect"
import { beforeAll, beforeEach, vi } from "vitest"

const sandboxTest = vi.hoisted(() => ({
  unreadable: false,
  created: 0,
  createFails: false,
  destroyed: [] as string[],
  files: new Map<string, Uint8Array>(),
  resumable: true,
}))

// The provider factory is a module function that builds the vendor adapter.
vi.mock("@/lib/sandboxes/factory.server", () => ({
  createSandboxProvider: () => Effect.succeed(fakeSandboxProvider),
}))

import { SandboxProviderUnreadable } from "@/lib/sandboxes/errors"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { artifactContentDigest } from "./artifacts.server.ts"
import { CHAT_SANDBOX_MAX_LIVE } from "./constants.server.ts"
import { ChatSandboxes, type ChatSandboxStatus } from "./sandbox.server.ts"

function fakeSandboxHandle(id: string): SandboxHandle {
  return {
    id,
    provider: "fake",
    workspaceRoot: "/workspace",
    fs: {
      readBytes: (path: string) => Promise.resolve(sandboxTest.files.get(path) ?? new Uint8Array()),
    },
  } as unknown as SandboxHandle
}

const fakeSandboxProvider = {
  name: "fake",
  capabilities: () => ({ snapshots: false }),
  create: () => {
    sandboxTest.created += 1
    return sandboxTest.createFails
      ? Promise.reject(new Error("vendor detail: token sk-secret"))
      : Promise.resolve(fakeSandboxHandle(`sandbox-${sandboxTest.created}`))
  },
  resume: ({ id }: { id: string }) =>
    Promise.resolve(sandboxTest.resumable ? fakeSandboxHandle(id) : null),
  destroy: ({ id }: { id: string }) => {
    sandboxTest.destroyed.push(id)
    return Promise.resolve()
  },
} as unknown as SandboxProvider

const sandboxesLayer = ChatSandboxes.layerNoDeps.pipe(
  Layer.provide(
    Layer.succeed(SandboxProviders, {
      resolveConfiguration: () =>
        sandboxTest.unreadable
          ? Effect.fail(new SandboxProviderUnreadable())
          : Effect.succeed({ name: "Local", provider: "docker", options: {}, credentials: {} }),
    } as unknown as SandboxProviders["Service"]),
  ),
)

function sessionFor(sandboxes: ChatSandboxes["Service"], threadId = "thread") {
  return sandboxes.session({
    sandboxProviderId: "01990a5d-ac96-774b-b942-6b13c85384cc",
    agentId: "01990a5d-ac96-774b-b942-6b13c85384cb",
    principal: {
      organization: { id: "01990a5d-ac96-774b-b942-6b13c85384ca" },
      tenantUser: { id: "user", tenant: { id: "tenant" } },
    },
    threadId,
    runId: "run",
    uploads: [],
  })
}

const noStatus = () => Effect.void

beforeAll(() => {
  vi.stubEnv("DATABASE_ENCRYPTION_KEY", "artifact-ticket-test-key-32-characters!!")
})

beforeEach(() => {
  Object.assign(sandboxTest, {
    unreadable: false,
    created: 0,
    createFails: false,
    destroyed: [],
    files: new Map(),
    resumable: true,
  })
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
    }).pipe(Effect.provide(sandboxesLayer)),
  )

  it.effect("degrades when the stored provider credentials cannot be decrypted", () =>
    Effect.gen(function* () {
      sandboxTest.unreadable = true
      const failure = yield* Effect.flip(sessionFor(yield* ChatSandboxes))
      assert.strictEqual(failure._tag, "ChatSandboxConfigurationUnreadable")
    }).pipe(Effect.provide(sandboxesLayer)),
  )

  it.effect("destroys every live sandbox when the service shuts down or reloads", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(sandboxesLayer, scope)
      const session = yield* sessionFor(Context.get(context, ChatSandboxes))
      yield* session.acquire(noStatus)
      assert.deepStrictEqual(sandboxTest.destroyed, [])
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1"])
    }),
  )

  it.effect("destroys the least recently used sandbox beyond the live cap", () =>
    Effect.gen(function* () {
      const sandboxes = yield* ChatSandboxes
      for (let thread = 0; thread <= CHAT_SANDBOX_MAX_LIVE; thread += 1) {
        const session = yield* sessionFor(sandboxes, `thread-${thread}`)
        yield* session.acquire(noStatus)
      }
      yield* Effect.yieldNow
      assert.deepStrictEqual(sandboxTest.destroyed, ["sandbox-1"])
    }).pipe(Effect.provide(sandboxesLayer)),
  )

  it.effect("serves only the exact bytes a ticket was minted for", () =>
    Effect.gen(function* () {
      const sandboxes = yield* ChatSandboxes
      const session = yield* sessionFor(sandboxes)
      const handle = yield* session.acquire(noStatus)
      const bytes = new TextEncoder().encode("A published report")
      sandboxTest.files.set("/workspace/report.txt", bytes)
      const ticket = yield* session.mintArtifactTicket({
        providerSandboxId: handle.id,
        path: "/workspace/report.txt",
        mimeType: "text/plain",
        size: bytes.byteLength,
        sha256: yield* artifactContentDigest(bytes),
      })
      const artifact = yield* sandboxes.readArtifact(ticket)
      assert.deepStrictEqual(artifact, {
        bytes,
        mimeType: "text/plain",
        path: "/workspace/report.txt",
      })

      sandboxTest.files.set("/workspace/report.txt", new TextEncoder().encode("changed"))
      const changed = yield* Effect.flip(sandboxes.readArtifact(ticket))
      assert.strictEqual(changed.reason, "Changed")
      sandboxTest.resumable = false
      const gone = yield* Effect.flip(sandboxes.readArtifact(ticket))
      assert.strictEqual(gone.reason, "SandboxGone")
      const invalid = yield* Effect.flip(sandboxes.readArtifact("not-a-ticket"))
      assert.strictEqual(invalid.reason, "Expired")
    }).pipe(Effect.provide(sandboxesLayer)),
  )
})
