import { messageResource } from "@/routes/api/v1/chat/-lib/threads.server"
import { deleteTenant } from "@/lib/tenants/deletion"
import { APP_HANDLE } from "@/lib/constants"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { FilePreviews } from "@/lib/storage/file-previews.server"
import { StorageObjectMissing } from "@/lib/storage/errors"
import { fileObject } from "@/db/schema/files"
import { ChatFiles } from "../attachments/attachments"
import { CHAT_ATTACHMENT_MAX_FILENAME_LENGTH } from "../attachments/constants"
import { and, eq, like, sql } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from "vitest"

const integration = vi.hoisted(() => {
  const configured = globalThis.process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
      throw new Error("Use a disposable loopback database ending in _test")
  }
  return { url }
})

import { Database, getAuthDatabase } from "@/db/database"
import { cacheEntry } from "@/db/schema/cache"
import { Agents } from "@/lib/agents/agents.server"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { prepareManagedChat, resolveManagedChatTools } from "./commands"
import type { ChatParams } from "../types"
import {
  agent,
  chatThread,
  chatMessage,
  chatFile,
  chatMessagePart,
  chatToolResponse,
  organization,
  organizationConfiguration,
  tenant,
  tenantUser,
} from "@/db/schema"
import { ChatThreads } from "./threads"
import { projectChatModelHistory } from "./projection"
import type {
  ChatThreadScope,
  ChatMessagePayload,
  ChatToolResolution,
  ChatWriterClaim,
} from "./schemas"

const payload: ChatMessagePayload = {
  version: 1,
  parts: [{ id: "019a0800-0000-7000-8000-000000000001", type: "text", content: "Hello" }],
}
const targetA = "019a0700-0000-7000-8000-000000000001"
const targetB = "019a0700-0000-7000-8000-000000000002"

function chatTestToolPayload(part: ChatMessagePayload["parts"][number]): ChatMessagePayload {
  return { version: 1, parts: [part] }
}

const objects = new Map<string, Uint8Array>()
const storage = globalThis.process.env.S3_BUCKET
  ? ObjectStorage.layer
  : Layer.succeed(ObjectStorage, {
      put: ({ key, bytes }) =>
        Effect.sync(() => {
          objects.set(key, bytes)
        }),
      get: ({ key }) =>
        objects.has(key)
          ? Effect.succeed(objects.get(key)!)
          : Effect.fail(new StorageObjectMissing()),
      head: ({ key }) =>
        objects.has(key)
          ? Effect.succeed({ size: objects.get(key)!.length, contentType: "text/plain" })
          : Effect.fail(new StorageObjectMissing()),
      remove: ({ key }) =>
        Effect.sync(() => {
          objects.delete(key)
        }),
      signedUrl: ({ key }) => Effect.succeed(`https://storage.example/${key}`),
      testConnection: () => Effect.die("unused"),
    })
const filesLayer = ChatFiles.layerNoDeps.pipe(
  Layer.provideMerge(FilePreviews.layerNoDeps),
  Layer.provideMerge(StoredFiles.layerNoDeps.pipe(Layer.provideMerge(storage))),
  Layer.provideMerge(Database.layer),
)
const runtime = ManagedRuntime.make(
  ChatThreads.layerNoDeps.pipe(Layer.provideMerge([filesLayer, UsageLimits.layer])),
)

describe.skipIf(!integration.url)("PostgreSQL chat conversations", () => {
  let db: ReturnType<typeof getAuthDatabase>
  let files: typeof ChatFiles.Service
  let service: Effect.Success<typeof ChatThreads>
  let scope: ChatThreadScope
  let other: ChatThreadScope
  let foreign: ChatThreadScope

  beforeAll(async () => {
    db = getAuthDatabase()
    service = await runtime.runPromise(ChatThreads)
    files = await runtime.runPromise(ChatFiles)
  })
  afterAll(async () => {
    await runtime.dispose()
  })
  beforeEach(async () => {
    await db.execute(sql`truncate organization cascade`)
    const [org] = await db
      .insert(organization)
      .values({ domain: "example.com", name: "Chat", slug: "chat" })
      .returning()
    const organizationId = org!.id
    const [model] = await db
      .insert(agent)
      .values({ organizationId, name: "Assistant", systemPrompt: "Help" })
      .returning()
    await db.insert(organizationConfiguration).values({ organizationId, defaultAgentId: model!.id })
    const tenants = await db
      .insert(tenant)
      .values([
        { organizationId, externalId: "same" },
        { organizationId, externalId: "foreign" },
      ])
      .returning()
    const people = await db
      .insert(tenantUser)
      .values([
        { organizationId, tenantId: tenants[0]!.id, externalId: "same" },
        { organizationId, tenantId: tenants[0]!.id, externalId: "other" },
        { organizationId, tenantId: tenants[1]!.id, externalId: "same" },
      ])
      .returning()
    scope = { organizationId, tenantId: tenants[0]!.id, tenantUserId: people[0]!.id }
    other = { ...scope, tenantUserId: people[1]!.id }
    foreign = { organizationId, tenantId: tenants[1]!.id, tenantUserId: people[2]!.id }
  })

  const complete = ({ claim, payload }: { claim: ChatWriterClaim; payload: ChatMessagePayload }) =>
    service
      .checkpoint({ claim, payload, state: "complete" })
      .pipe(Effect.andThen(service.finish({ claim })))

  const create = () => runtime.runPromise(service.create({ scope }))
  const admit = (id: string) =>
    runtime.runPromise(
      service.admit({
        scope,
        id,
        payload: {
          ...payload,
          parts: payload.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        },
      }),
    )

  test("published files belong to the assistant message, remain scoped, and retire with their conversation", async () => {
    const thread = await create()
    const { claim } = await admit(thread.id)
    const report = "x".repeat(2 * 1024 * 1024)
    const bytes = new TextEncoder().encode(report)
    const fileId = await runtime.runPromise(service.publishArtifact({ claim: claim!, bytes }))
    const [association] = await db.select().from(chatFile).where(eq(chatFile.fileObjectId, fileId))
    expect(association).toMatchObject({ messageId: claim!.assistantMessageId, threadId: thread.id })
    expect(association!.id).not.toBe(fileId)
    const stored = await runtime.runPromise(
      files.read({ scope: { ...scope, threadId: thread.id }, fileId }),
    )
    expect(new TextDecoder().decode(stored.bytes)).toBe(report)
    await expect(
      runtime.runPromise(files.read({ scope: { ...foreign, threadId: thread.id }, fileId })),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    const empty = await create()
    await expect(
      runtime.runPromise(files.read({ scope: { ...scope, threadId: empty.id }, fileId })),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    await runtime.runPromise(service.remove({ scope, id: thread.id, lockVersion: 1 }))
    const [retired] = await db.select().from(fileObject).where(eq(fileObject.id, fileId))
    expect(retired!.status).toBe("purging")
    expect(await db.select().from(chatFile).where(eq(chatFile.fileObjectId, fileId))).toEqual([])
  })

  test("native evidence completes without response slots and survives a database reload", async () => {
    const thread = await create()
    const admitted = await admit(thread.id)
    const id = crypto.randomUUID()
    const source = { url: "https://example.com/page", title: "Example", excerpt: "Actual page" }
    const evidence: ChatMessagePayload = {
      version: 1,
      parts: [
        {
          id: crypto.randomUUID(),
          type: "text",
          content: "Answer",
          metadata: {
            web: { sources: [], citations: [{ ...source, startIndex: 0, endIndex: 6, number: 1 }] },
          },
        },
        {
          id,
          type: "tool-call",
          toolCallId: id,
          name: "web_access",
          arguments: "{}",
          executionLocation: "provider",
          targets: [],
          state: "complete",
          metadata: { providerExecuted: true, web: { sources: [source], citations: [] } },
        },
      ],
      provenance: { providerId: "provider", protocol: "responses", modelId: "model" },
      modelMessages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Answer",
          metadata: { webProviderContext: [{ type: "web_search_call", id: "opaque" }] },
        },
      ],
    }
    await runtime.runPromise(complete({ claim: admitted.claim!, payload: evidence }))
    expect(await db.select().from(chatToolResponse)).toHaveLength(0)
    const records = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(records[1]!.payload.parts).toEqual(evidence.parts)
    expect(
      JSON.stringify(
        projectChatModelHistory(records, {
          providerId: "provider",
          protocol: "responses",
          modelId: "model",
        }),
      ),
    ).toContain("opaque")
    const portable = JSON.stringify(projectChatModelHistory(records))
    expect(portable).not.toContain("opaque")
    expect(portable).toContain(source.url)
  })

  test("administrative history and uploads preserve scope without granting participant actions", async () => {
    const thread = await create()
    const prepared = await runtime.runPromise(
      files.store({
        scope: { ...scope, threadId: thread.id },
        payload: {
          version: 1,
          parts: [
            { id: crypto.randomUUID(), type: "text", content: "Administrative history" },
            {
              id: crypto.randomUUID(),
              type: "document",
              source: { type: "data", value: "SGVsbG8=", mimeType: "text/plain" },
              metadata: { filename: "note.txt", size: 999 },
            },
          ],
        },
      }),
    )
    const [pending] = await db.select().from(chatFile)
    expect(pending).toMatchObject({
      messageId: null,
      threadId: null,
      fileObjectId: (prepared.parts[1]!.source as { id: string }).id,
    })
    expect(pending!.id).not.toBe(pending!.fileObjectId)
    await expect(
      runtime.runPromise(
        service.admit({
          scope: other,
          id: (await runtime.runPromise(service.create({ scope: other }))).id,
          payload: prepared,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    const referenced = await runtime.runPromise(
      files.store({
        scope: { ...scope, threadId: thread.id },
        payload: {
          ...prepared,
          parts: [
            prepared.parts[0]!,
            {
              ...prepared.parts[1]!,
              source: { type: "file", value: pending!.fileObjectId, mimeType: "image/png" },
            },
          ],
        },
      }),
    )
    expect(referenced).toEqual(prepared)
    expect(await db.select().from(fileObject)).toHaveLength(1)
    const preview = await runtime.runPromise(
      files.read({ scope, fileId: pending!.fileObjectId, preview: true }),
    )
    expect(preview?.mimeType).toBe("image/webp")
    const download = { fileId: pending!.fileObjectId, preview: true, contentDisposition: "inline" }
    expect(await runtime.runPromise(files.download({ ...download, scope }))).toHaveProperty(
      "url",
      expect.stringContaining(".preview.webp"),
    )
    for (const deniedScope of [other, foreign]) {
      await expect(
        runtime.runPromise(
          files.read({ scope: deniedScope, fileId: pending!.fileObjectId, preview: true }),
        ),
      ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
      await expect(
        runtime.runPromise(files.download({ ...download, scope: deniedScope })),
      ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    }
    await runtime.runPromise(service.admit({ scope, id: thread.id, payload: referenced }))
    const input = {
      scope: { organizationId: scope.organizationId },
      tenantId: scope.tenantId,
      id: thread.id,
    }
    const snapshot = await runtime.runPromise(service.directorySnapshot(input))
    expect(snapshot.messages.items.map((message) => message.role)).toEqual(["user", "assistant"])
    expect((await runtime.runPromise(service.directoryGet(input))).id).toBe(thread.id)
    const message = snapshot.messages.items[0]!
    expect(messageResource(message).parts[1]).toMatchObject({
      source: { type: "attachment", byteSize: 5 },
    })
    const messages = projectChatModelHistory([message]).map((message) => ({
      ...message,
      createdAt: new Date("2026-01-01"),
    }))
    const hydrated = await runtime.runPromise(
      files.hydrate({ scope: { ...scope, threadId: thread.id }, messages }),
    )
    expect(hydrated[0]!.content).toMatchObject([
      { type: "text" },
      { source: { type: "data", value: "SGVsbG8=", byteSize: 5 } },
    ])
    expect(hydrated[0]!.createdAt).toEqual(new Date("2026-01-01"))
    const source = message.payload.parts[1]!.source as { id: string }
    const file = await runtime.runPromise(
      files.read({ scope: { ...scope, threadId: thread.id }, fileId: source.id }),
    )
    expect(new TextDecoder().decode(file.bytes)).toBe("Hello")
    expect(await db.select().from(chatFile)).toMatchObject([
      { messageId: message.id, fileObjectId: source.id },
    ])
    await expect(
      runtime.runPromise(
        files.read({ scope: { ...foreign, threadId: thread.id }, fileId: source.id }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    expect(snapshot.thread).not.toHaveProperty("role")
    for (const operation of [
      service.directorySnapshot({ ...input, scope: { organizationId: crypto.randomUUID() } }),
      service.directorySnapshot({
        ...input,
        scope: { organizationId: scope.organizationId, tenantId: foreign.tenantId },
      }),
      service.directoryGet({ ...input, tenantId: foreign.tenantId }),
      service.get({ scope: other, id: thread.id }),
      service.admit({ scope: other, id: thread.id, payload }),
      service.rename({ scope: other, id: thread.id, title: "Forbidden", lockVersion: 1 }),
      service.remove({ scope: other, id: thread.id, lockVersion: 1 }),
      service.setParticipant({
        scope: other,
        id: thread.id,
        tenantUserId: other.tenantUserId,
        role: "manager",
        lockVersion: 1,
      }),
      service.resolveTools({ scope: other, id: thread.id, clientId: "browser", results: [] }),
    ])
      expect(await runtime.runPromise(Effect.result(operation))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ChatThreadNotFound" },
      })
    expect(
      (await runtime.runPromise(service.participants({ scope, id: thread.id }))).items.map(
        (participant) => participant.tenantUserId,
      ),
    ).toEqual([scope.tenantUserId])
  })

  test("administrative activity pages order equal timestamps across Tenants and search literal titles", async () => {
    await db
      .update(tenantUser)
      .set({ name: "Local participant" })
      .where(eq(tenantUser.id, scope.tenantUserId))
    await db
      .update(tenantUser)
      .set({ name: "Foreign participant" })
      .where(eq(tenantUser.id, foreign.tenantUserId))
    const ids = [] as { id: string; tenantId: string }[]
    await create()
    for (const current of [scope, foreign]) {
      for (const title of ["Budget 50%_done", "Budget other"]) {
        const thread = await runtime.runPromise(service.create({ scope: current, title }))
        await runtime.runPromise(service.admit({ scope: current, id: thread.id, payload }))
        ids.push({ id: thread.id, tenantId: current.tenantId })
      }
    }
    await db
      .update(chatThread)
      .set({ updatedAt: sql`'2026-10-06 01:02:03.123456+00'::timestamptz` })
      .where(eq(chatThread.organizationId, scope.organizationId))
    const input = { scope: { organizationId: scope.organizationId }, pageSize: 1 }
    const expected = ids
      .toSorted((a, b) => b.tenantId.localeCompare(a.tenantId) || b.id.localeCompare(a.id))
      .map((row) => row.id)
    const first = await runtime.runPromise(service.directoryList(input))
    const second = await runtime.runPromise(
      service.directoryList({ ...input, position: first.nextPosition! }),
    )
    expect(first.items[0]!.id).toBe(expected[0])
    expect(second.items[0]!.id).toBe(expected[1])
    expect(first.nextPosition!.updatedAt).toContain(".123456")
    const previous = await runtime.runPromise(
      service.directoryList({ ...input, position: second.previousPosition!, backward: true }),
    )
    expect(previous.items.map((row) => row.id)).toEqual([expected[0]])
    const all = await runtime.runPromise(service.directoryList({ scope: input.scope }))
    expect(all.items.map((row) => row.id)).toEqual(expected)
    for (const row of all.items)
      expect(row.participants).toEqual([
        {
          name: row.tenantId === scope.tenantId ? "Local participant" : "Foreign participant",
          externalId: "same",
        },
      ])
    expect(
      (await runtime.runPromise(service.directoryList({ scope: input.scope, search: "50%_" })))
        .items,
    ).toHaveLength(2)
    expect(
      (
        await runtime.runPromise(
          service.directoryList({ scope: { ...input.scope, tenantId: scope.tenantId } }),
        )
      ).items,
    ).toHaveLength(2)
    expect(
      (
        await runtime.runPromise(
          service.directoryList({ scope: { organizationId: crypto.randomUUID() } }),
        )
      ).items,
    ).toEqual([])
    expect(
      (
        await runtime.runPromise(
          service.directoryList({ scope: { ...input.scope, tenantId: null } }),
        )
      ).items,
    ).toEqual([])
  })

  test("lists only accepted history and initializes a blank title once", async () => {
    const empty = await create()
    const thread = await create()
    expect((await runtime.runPromise(service.list({ scope }))).items).toEqual([])
    const text = "  First\n  message " + "🙂".repeat(80)
    const accepted = await runtime.runPromise(
      service.admit({
        scope,
        id: thread.id,
        payload: { version: 1, parts: [{ id: crypto.randomUUID(), type: "text", content: text }] },
      }),
    )
    const title = "First message " + "🙂".repeat(66)
    expect(accepted.thread.title).toBe(title)
    expect(
      (await runtime.runPromise(service.list({ scope }))).items.map((thread) => thread.id),
    ).toEqual([thread.id])
    await admit(thread.id)
    expect((await runtime.runPromise(service.get({ scope, id: thread.id }))).title).toBe(title)
    await runtime.runPromise(
      service.rename({ scope, id: empty.id, title: "Custom title", lockVersion: 0 }),
    )
    expect((await runtime.runPromise(service.list({ scope }))).items).toHaveLength(1)
    expect((await admit(empty.id)).thread.title).toBe("Custom title")
  })

  test("rejects invalid file signatures before creating objects", async () => {
    await expect(
      runtime.runPromise(
        files.store({
          scope,
          payload: {
            version: 1,
            parts: [
              {
                id: crypto.randomUUID(),
                type: "image",
                source: { type: "data", value: "AAAA", mimeType: "image/png" },
              },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    expect(await db.select().from(fileObject)).toEqual([])
  })

  test.each(["thread", "Tenant"])(
    "stream checkpoints share verified content and %s deletion retires it",
    async (target) => {
      const thread = await create()
      const accepted = await admit(thread.id)
      const media = {
        id: crypto.randomUUID(),
        type: "image",
        source: { type: "data", value: "iVBORw0KGgo=", mimeType: "image/png" },
      }
      const generated: ChatMessagePayload = {
        version: 1,
        parts: [media],
        modelMessages: [
          { role: "assistant", content: [media], providerContext: { signature: "keep-me" } },
        ],
      }
      const cache = new Map()
      for (let i = 0; i < 3; i++)
        await runtime.runPromise(
          service.checkpoint({ claim: accepted.claim!, payload: generated, state: "draft", cache }),
        )
      await runtime.runPromise(
        service.checkpoint({
          claim: accepted.claim!,
          payload: generated,
          state: "complete",
          cache,
        }),
      )
      const rows = await db.select().from(fileObject).where(eq(fileObject.status, "stored"))
      expect(rows).toHaveLength(1)
      expect(await db.select().from(chatFile)).toMatchObject([
        { messageId: accepted.assistantMessage!.id, fileObjectId: rows[0]!.id },
      ])
      const saved = await runtime.runPromise(
        service.history({ scope, id: thread.id, messageId: accepted.assistantMessage!.id }),
      )
      expect(saved.at(-1)!.payload).toMatchObject({
        parts: [{ source: { type: APP_HANDLE, id: rows[0]!.id } }],
        modelMessages: [
          { providerContext: { signature: "keep-me" }, content: [{ source: { id: rows[0]!.id } }] },
        ],
      })
      await runtime.runPromise(files.store({ scope, payload: generated }))
      await runtime.runPromise(service.finish({ claim: accepted.claim! }))
      expect((await db.select().from(fileObject)).map((file) => file.status).sort()).toEqual([
        "stored",
        "stored",
      ])
      if (target === "thread")
        await runtime.runPromise(
          service.remove({ scope, id: thread.id, lockVersion: accepted.thread.lockVersion }),
        )
      else
        await runtime.runPromise(
          deleteTenant({ organizationId: scope.organizationId, tenantId: scope.tenantId }),
        )
      expect((await db.select().from(fileObject)).map((file) => file.status).sort()).toEqual([
        "purging",
        target === "Tenant" ? "purging" : "stored",
      ])
    },
  )

  test("searches authorized titles across pages and treats wildcards literally", async () => {
    const ids = []
    for (const title of ["Budget 50%_done", "budget 50xxdone", "Unrelated"]) {
      const thread = await runtime.runPromise(service.create({ scope, title }))
      await admit(thread.id)
      ids.push(thread.id)
    }
    const hidden = await runtime.runPromise(
      service.create({ scope: other, title: "Budget private" }),
    )
    await runtime.runPromise(service.admit({ scope: other, id: hidden.id, payload }))
    const first = await runtime.runPromise(service.list({ scope, search: "BUDGET", pageSize: 1 }))
    const next = await runtime.runPromise(
      service.list({ scope, search: "BUDGET", pageSize: 1, position: first.nextPosition! }),
    )
    expect([first.items[0]!.id, next.items[0]!.id].sort()).toEqual(ids.slice(0, 2).sort())
    expect(next.nextPosition).toBeNull()
    expect(
      (await runtime.runPromise(service.list({ scope, search: "%_" }))).items.map(
        (item) => item.id,
      ),
    ).toEqual([ids[0]])
    expect(
      (await runtime.runPromise(service.list({ scope: foreign, search: "Budget" }))).items,
    ).toEqual([])
  })

  test("replays receipts after quota exhaustion, reauthorizes retries, and purges retained input", async () => {
    const thread = await create()
    const usageLimits = await runtime.runPromise(UsageLimits)
    const usageLimitId = await runtime.runPromise(
      usageLimits.create({
        organizationId: scope.organizationId,
        fields: {
          name: "Chat budget",
          enabled: true,
          appliesByDefault: false,
          scope: "tenant_user",
          metric: "tokens",
          amount: "1",
          windowType: "rolling",
          windowCount: 1,
          windowUnit: "hour",
          timeZone: null,
        },
      }),
    )
    const uploaded = await runtime.runPromise(
      files.store({
        scope,
        payload: {
          version: 1,
          parts: [
            {
              id: crypto.randomUUID(),
              type: "document",
              source: { type: "data", value: "SGVsbG8=", mimeType: "text/plain" },
            },
          ],
        },
      }),
    )
    const fileId = (uploaded.parts[0]!.source as { id: string }).id
    const params: ChatParams = {
      threadId: thread.id,
      runId: "first-run",
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text", content: "Hello" },
            {
              type: "document",
              source: { type: "file", value: fileId, mimeType: "text/plain" },
              metadata: { filename: `note\n${"x".repeat(500)}` },
            },
          ],
        },
      ],
      tools: [],
      aguiContext: [],
      state: undefined,
      forwardedProps: { clientId: targetA },
    }
    const request = { scope, params, idempotencyKey: "same-intent", usageLimitIds: [usageLimitId] }
    const run = (input: typeof request) =>
      runtime.runPromise(
        prepareManagedChat(input).pipe(
          Effect.provideService(Agents, {
            resolveForChat: () =>
              Effect.succeed({ attachmentsEnabled: true, sandboxProviderId: null }),
          } as unknown as typeof Agents.Service),
        ),
      )
    for (const [value, mimeType] of [
      ["/w==", "text/plain"],
      ["UEFSMQ==", "application/vnd.apache.parquet"],
    ] as const) {
      const invalid = await runtime.runPromise(
        files.store({
          scope,
          payload: {
            version: 1,
            parts: [
              {
                id: crypto.randomUUID(),
                type: "document",
                source: { type: "data", value, mimeType },
              },
            ],
          },
        }),
      )
      await expect(
        run({
          ...request,
          params: {
            ...params,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "file",
                      value: (invalid.parts[0]!.source as { id: string }).id,
                      mimeType,
                    },
                  },
                ],
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
      expect(await runtime.runPromise(service.history({ scope, id: thread.id }))).toHaveLength(0)
    }
    const first = await run(request)
    expect(first.admission?.claim).toBeTruthy()
    expect(first.admission!.inputMessage.payload.parts[1]!.metadata).toEqual({
      filename: `note ${"x".repeat(CHAT_ATTACHMENT_MAX_FILENAME_LENGTH - 5)}…`,
    })
    const limits = await runtime.runPromise(
      usageLimits.applicable({ organizationId: scope.organizationId, listedIds: [usageLimitId] }),
    )
    await runtime.runPromise(
      usageLimits.record({ limits, subject: scope, usage: { tokens: 1, spend: "0" } }),
    )
    const retry = await run({ ...request, params: { ...params, runId: "retry-run" } })
    expect(retry).toMatchObject({ admission: undefined, receipt: first.receipt })
    const storedFileCount = (await db.select().from(fileObject)).length
    const inlineFile = {
      type: "document",
      source: { type: "data", value: "SGVsbG8=", mimeType: "text/plain" },
    } as const
    await expect(
      run({
        ...request,
        idempotencyKey: "new-intent",
        params: {
          ...params,
          messages: [{ role: "user", content: [inlineFile] }],
        },
      }),
    ).rejects.toMatchObject({ _tag: "UsageLimitReached" })
    expect(await db.select().from(fileObject)).toHaveLength(storedFileCount)
    expect(await runtime.runPromise(service.history({ scope, id: thread.id }))).toHaveLength(2)
    await expect(
      run({ ...request, params: { ...params, messages: [{ role: "user", content: "Changed" }] } }),
    ).rejects.toMatchObject({ _tag: "IdempotencyParametersMismatch" })
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 1,
        tenantUserId: other.tenantUserId,
        role: "manager",
      }),
    )
    await runtime.runPromise(
      service.setParticipant({
        scope: other,
        id: thread.id,
        lockVersion: 2,
        tenantUserId: scope.tenantUserId,
        role: "viewer",
      }),
    )
    await expect(run(request)).rejects.toMatchObject({
      _tag: "ChatThreadForbidden",
    })
    expect(
      await db
        .select()
        .from(cacheEntry)
        .where(
          and(
            eq(cacheEntry.namespace, "chat"),
            like(cacheEntry.key, `${scope.organizationId}:${scope.tenantId}:${thread.id}:%`),
          ),
        ),
    ).toHaveLength(1)
    await runtime.runPromise(
      service.removeParticipant({
        scope: other,
        id: thread.id,
        lockVersion: 3,
        tenantUserId: scope.tenantUserId,
      }),
    )
    await expect(run(request)).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    await runtime.runPromise(service.remove({ scope: other, id: thread.id, lockVersion: 4 }))
    expect(
      await db
        .select()
        .from(cacheEntry)
        .where(
          and(
            eq(cacheEntry.namespace, "chat"),
            like(cacheEntry.key, `${scope.organizationId}:${scope.tenantId}:${thread.id}:%`),
          ),
        ),
    ).toEqual([])
    await expect(run(request)).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
  })

  test("resolves synchronized identities and grants access only through explicit same-Tenant participants", async () => {
    expect(
      await runtime.runPromise(
        service.resolveScope({
          principal: {
            organization: { id: scope.organizationId },
            tenantUser: { id: "same", tenant: { id: "same" } },
          },
        }),
      ),
    ).toEqual(scope)
    await expect(
      runtime.runPromise(
        service.resolveScope({
          principal: {
            organization: { id: scope.organizationId },
            tenantUser: { id: "missing", tenant: { id: "same" } },
          },
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatIdentityNotSynchronized" })
    const thread = await create()
    await expect(
      runtime.runPromise(service.get({ scope: other, id: thread.id })),
    ).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    await expect(
      runtime.runPromise(
        service.setParticipant({
          scope,
          id: thread.id,
          lockVersion: 0,
          tenantUserId: foreign.tenantUserId,
          role: "member",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 0,
        tenantUserId: other.tenantUserId,
        role: "viewer",
      }),
    )
    expect((await runtime.runPromise(service.get({ scope: other, id: thread.id }))).role).toBe(
      "viewer",
    )
    await expect(
      runtime.runPromise(
        service.admit({
          scope: other,
          id: thread.id,
          payload,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadForbidden" })
  })

  test("preserves an execution through renaming and rejects finalized writes", async () => {
    const thread = await create()
    const admitted = await admit(thread.id)
    const claimed = admitted.claim!
    await runtime.runPromise(
      service.rename({ scope, id: thread.id, lockVersion: 1, title: "Renamed" }),
    )
    await runtime.runPromise(service.assertActive({ claim: claimed }))
    const answer: ChatMessagePayload = {
      version: 1,
      invocationId: "untrusted-output-id",
      parts: [{ id: "019a0800-0000-7000-8000-000000000002", type: "text", content: "Saved" }],
      modelMessages: [
        { role: "assistant", content: "Saved", providerMetadata: { opaque: "signature" } },
      ],
    }
    await runtime.runPromise(complete({ claim: claimed, payload: answer }))
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(history.map((message) => message.state)).toEqual(["complete", "complete"])
    expect(history[1]!.metadata.invocationId).toBe(claimed.invocationId)
    expect(history[1]!.payload.modelMessages).toEqual(answer.modelMessages)
    await expect(
      runtime.runPromise(service.checkpoint({ claim: claimed, payload, state: "draft" })),
    ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })
  })

  test("orders admission activity by append time rather than transaction start", async () => {
    const thread = await create()
    const { admitted, afterWait } = await runtime.runPromise(
      Effect.gen(function* () {
        const database = yield* Database
        return yield* database.transaction((tx) =>
          Effect.gen(function* () {
            const [waited] = yield* tx.execute<{ after_wait: string }>(
              sql`select clock_timestamp()::text as after_wait from pg_sleep(0.02)`,
              "objects",
            )
            const admitted = yield* service.admit({ scope, id: thread.id, payload })
            return { admitted, afterWait: new Date(waited!.after_wait) }
          }),
        )
      }),
    )
    expect(admitted.thread.updatedAt.getTime()).toBeGreaterThanOrEqual(afterWait.getTime())
  })

  test("counts uploads only in their thread and rejects concurrent uploads beyond its budget", async () => {
    const thread = await create()
    const file = Buffer.alloc(10 * 1024 * 1024, " ")
    file.write("%PDF-1.7")
    const upload = () =>
      Effect.gen(function* () {
        const payload = yield* files.store({
          scope: { ...scope, threadId: thread.id },
          payload: {
            version: 1,
            parts: [
              {
                id: crypto.randomUUID(),
                type: "document",
                source: {
                  type: "data",
                  value: file.toString("base64"),
                  mimeType: "application/pdf",
                },
              },
            ],
          },
        })
        return yield* service.admit({ scope, id: thread.id, payload })
      })
    await runtime.runPromise(upload())
    const separate = await runtime.runPromise(service.create({ scope: other }))
    const [original] = await db
      .select()
      .from(chatMessage)
      .where(and(eq(chatMessage.threadId, thread.id), eq(chatMessage.role, "user")))
    await db.insert(chatMessage).values({ ...original!, threadId: separate.id })
    const results = await Promise.allSettled([
      runtime.runPromise(upload()),
      runtime.runPromise(upload()),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { _tag: "ChatThreadInvalid" },
    })
    expect(
      await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.threadId, thread.id)),
    ).toHaveLength(4)
    await admit(thread.id)
    expect(
      await db
        .select({ id: chatMessage.id })
        .from(chatMessage)
        .where(eq(chatMessage.threadId, thread.id)),
    ).toHaveLength(6)
  })

  test("retains a manager while allowing a second manager to remove themselves", async () => {
    const thread = await create()
    await expect(
      runtime.runPromise(
        service.removeParticipant({
          scope,
          id: thread.id,
          lockVersion: 0,
          tenantUserId: scope.tenantUserId,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 0,
        tenantUserId: other.tenantUserId,
        role: "manager",
      }),
    )
    await runtime.runPromise(
      service.removeParticipant({
        scope,
        id: thread.id,
        lockVersion: 1,
        tenantUserId: scope.tenantUserId,
      }),
    )
    expect((await runtime.runPromise(service.get({ scope: other, id: thread.id }))).role).toBe(
      "manager",
    )
    await expect(
      runtime.runPromise(
        service.setParticipant({
          scope: other,
          id: thread.id,
          lockVersion: 2,
          tenantUserId: other.tenantUserId,
          role: "viewer",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })
  })

  test("concurrent participants append one chain and finishing an older execution never rewinds its leaf", async () => {
    const thread = await create()
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 0,
        tenantUserId: other.tenantUserId,
        role: "member",
      }),
    )
    const admitted = await Promise.all([
      admit(thread.id),
      runtime.runPromise(
        service.admit({
          scope: other,
          id: thread.id,
          payload,
        }),
      ),
    ])
    expect(admitted.every((entry) => entry.claim !== null)).toBe(true)
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(history).toHaveLength(4)
    expect(history.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    expect(history.map((message) => message.parentMessageId)).toEqual([
      null,
      ...history.slice(0, -1).map((message) => message.id),
    ])
    expect(
      new Set(
        history
          .filter((message) => message.role === "user")
          .map((message) => message.authorTenantUserId),
      ),
    ).toEqual(new Set([scope.tenantUserId, other.tenantUserId]))
    const first = admitted.find((entry) => entry.assistantMessage!.id === history[1]!.id)!
    const second = admitted.find((entry) => entry.assistantMessage!.id === history[3]!.id)!
    expect(
      (
        await runtime.runPromise(
          service.history({ scope, id: thread.id, messageId: first.assistantMessage!.id }),
        )
      ).map((message) => message.id),
    ).toEqual(history.slice(0, 2).map((message) => message.id))
    await runtime.runPromise(
      complete({
        claim: second.claim!,
        payload: {
          ...payload,
          parts: payload.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        },
      }),
    )
    await runtime.runPromise(complete({ claim: first.claim!, payload }))
    expect(
      (await runtime.runPromise(service.get({ scope, id: thread.id }))).currentLeafMessageId,
    ).toBe(second.assistantMessage!.id)
    expect(
      (await runtime.runPromise(service.history({ scope, id: thread.id }))).map(
        (message) => message.state,
      ),
    ).toEqual(["complete", "complete", "complete", "complete"])
  })

  test("final reasoning can precede streamed text without replacing its part identity", async () => {
    const thread = await create()
    const accepted = await admit(thread.id)
    const streamed = {
      ...payload,
      parts: [
        ...payload.parts,
        { id: crypto.randomUUID(), type: "text", content: "Second segment" },
      ],
    }
    await runtime.runPromise(
      service.checkpoint({ claim: accepted.claim!, payload: streamed, state: "draft" }),
    )
    const final = {
      ...streamed,
      parts: [
        { id: crypto.randomUUID(), type: "thinking", content: "Reasoning" },
        ...streamed.parts,
      ],
    }
    await runtime.runPromise(
      service.checkpoint({ claim: accepted.claim!, payload: final, state: "complete" }),
    )
    await runtime.runPromise(service.finish({ claim: accepted.claim! }))
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(history[1]!.payload.parts).toEqual(final.parts)
    expect(history[1]!.state).toBe("complete")
    expect(history[0]!.turnState).toBe("completed")
  })

  test("a superseded model phase cannot finish or interrupt its later phase", async () => {
    const thread = await create()
    const first = await admit(thread.id)
    await runtime.runPromise(
      service.checkpoint({ claim: first.claim!, payload, state: "complete" }),
    )
    const next = await runtime.runPromise(service.nextDraft({ claim: first.claim! }))
    for (const state of ["draft", "complete"] as const) {
      if (state === "complete")
        await runtime.runPromise(
          service.checkpoint({
            claim: next,
            payload: {
              ...payload,
              parts: payload.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
            },
            state,
          }),
        )
      await expect(
        runtime.runPromise(service.finish({ claim: first.claim! })),
      ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })
      await runtime.runPromise(service.interrupt({ claim: first.claim! }))
      await runtime.runPromise(service.assertActive({ claim: next }))
    }
    await runtime.runPromise(service.finish({ claim: next }))
  })

  test("server input rejection settles a browser decision without authorizing its execution", async () => {
    const thread = await create()
    const { claim } = await admit(thread.id)
    const partId = crypto.randomUUID()
    await runtime.runPromise(
      service.checkpoint({
        claim: claim!,
        state: "complete",
        payload: chatTestToolPayload({
          id: partId,
          type: "tool-call",
          toolCallId: "invalid-input",
          name: "update_record",
          arguments: "{",
          executionLocation: "browser",
          targets: [{ id: targetA, tenantUserId: scope.tenantUserId, clientId: targetA }],
        }),
      }),
    )
    const result: ChatToolResolution = {
      assistantMessageId: claim!.assistantMessageId,
      toolPartId: partId,
      responseTargetId: targetA,
      payload: chatTestToolPayload({
        id: crypto.randomUUID(),
        type: "tool-result",
        outcome: "failed",
        output: { error: "Invalid tool input" },
      }),
    }
    for (const outcome of ["succeeded", "unknown"]) {
      await expect(
        runtime.runPromise(
          service.appendToolResults({
            claim: claim!,
            results: [
              {
                ...result,
                payload: { ...result.payload, parts: [{ ...result.payload.parts[0]!, outcome }] },
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ _tag: "ChatThreadForbidden" })
    }
    await runtime.runPromise(service.appendToolResults({ claim: claim!, results: [result] }))
    const next = await runtime.runPromise(service.nextDraft({ claim: claim! }))
    await runtime.runPromise(complete({ claim: next, payload }))
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(history[0]!.turnState).toBe("completed")
    expect(history.filter((message) => message.role === "tool")).toMatchObject([
      { authorTenantUserId: null, payload: { parts: [{ outcome: "failed" }] } },
    ])
    expect((await runtime.runPromise(service.snapshot({ scope, id: thread.id }))).pending).toEqual(
      [],
    )
  })

  test("unfinished foreground turns survive reload without blocking new turns", async () => {
    const thread = await create()
    const abandoned = await admit(thread.id)
    await runtime.runPromise(
      service.checkpoint({ claim: abandoned.claim!, payload, state: "draft" }),
    )
    const snapshot = await runtime.runPromise(service.snapshot({ scope, id: thread.id }))
    expect(
      snapshot.messages.items.find((message) => message.id === abandoned.assistantMessage!.id)!
        .state,
    ).toBe("draft")
    expect(
      snapshot.messages.items.find((message) => message.id === abandoned.inputMessage.id)!
        .turnState,
    ).toBe("running")
    const next = await admit(thread.id)
    await runtime.runPromise(
      complete({
        claim: next.claim!,
        payload: {
          ...payload,
          parts: payload.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        },
      }),
    )
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(
      history.find((message) => message.id === abandoned.assistantMessage!.id)!.payload.parts,
    ).toEqual(payload.parts)
    expect(history.find((message) => message.id === next.inputMessage.id)!.turnState).toBe(
      "completed",
    )
  })

  test("participant revocation fences late writes without affecting another participant’s turn", async () => {
    const thread = await create()
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 0,
        tenantUserId: other.tenantUserId,
        role: "manager",
      }),
    )
    const next = await admit(thread.id)
    const survivor = await runtime.runPromise(
      service.admit({
        scope: other,
        id: thread.id,
        payload,
      }),
    )
    await runtime.runPromise(
      service.removeParticipant({
        scope: other,
        id: thread.id,
        lockVersion: 3,
        tenantUserId: scope.tenantUserId,
      }),
    )
    await expect(
      runtime.runPromise(service.assertActive({ claim: next.claim! })),
    ).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    await runtime.runPromise(service.assertActive({ claim: survivor.claim! }))
    await runtime.runPromise(
      service.setParticipant({
        scope: other,
        id: thread.id,
        lockVersion: 4,
        tenantUserId: scope.tenantUserId,
        role: "member",
      }),
    )
    await expect(
      runtime.runPromise(service.assertActive({ claim: next.claim! })),
    ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })

    await expect(
      runtime.runPromise(
        service.removeParticipant({
          scope: other,
          id: thread.id,
          lockVersion: 5,
          tenantUserId: other.tenantUserId,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })
    expect(
      (await runtime.runPromise(service.history({ scope: other, id: thread.id }))).find(
        (message) => message.id === next.assistantMessage!.id,
      )!.state,
    ).toBe("interrupted")
  })

  test("response preflight rejects viewer, client and target mismatches before validating output", async () => {
    const thread = await create()
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 0,
        tenantUserId: other.tenantUserId,
        role: "viewer",
      }),
    )
    const admitted = await admit(thread.id)
    const claim = admitted.claim!
    const partId = "019a0800-0000-7000-8000-000000000003"
    await runtime.runPromise(
      service.checkpoint({
        claim,
        state: "complete",
        payload: chatTestToolPayload({
          id: partId,
          type: "tool-call",
          toolCallId: "preflight-call",
          name: "update_record",
          arguments: "{}",
          executionLocation: "browser",
          declaration: { outputSchema: { type: "integer", minimum: 1, maximum: 5 } },
          targets: [{ id: targetA, tenantUserId: scope.tenantUserId, clientId: targetA }],
        }),
      }),
    )
    await runtime.runPromise(service.finish({ claim }))
    const result = {
      sourceMessageId: claim.assistantMessageId,
      sourcePartId: partId,
      responseTargetId: targetA,
      outcome: "succeeded" as const,
      output: 100,
    }
    const submit = (selectedScope: ChatThreadScope, clientId: string, changed = result) =>
      runtime.runPromise(
        resolveManagedChatTools({
          scope: selectedScope,
          id: thread.id,
          clientId,
          results: [changed],
        }),
      )
    await expect(submit(other, targetA)).rejects.toMatchObject({ _tag: "ChatThreadForbidden" })
    await expect(submit(scope, "wrong-client")).rejects.toMatchObject({
      _tag: "ChatThreadForbidden",
    })
    await expect(
      submit(scope, targetA, { ...result, responseTargetId: targetB }),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    await expect(submit(scope, targetA)).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    expect(await submit(scope, targetA, { ...result, output: 3 })).toMatchObject({
      claim: { threadId: thread.id },
    })
  })

  test("resolves earlier tools during newer execution and continues once after all response targets answer", async () => {
    const thread = await create()
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: 0,
        tenantUserId: other.tenantUserId,
        role: "member",
      }),
    )
    const admitted = await admit(thread.id)
    const claim = admitted.claim!
    await runtime.runPromise(
      service.checkpoint({
        claim,
        state: "complete",
        payload: chatTestToolPayload({
          id: "019a0800-0000-7000-8000-000000000003",
          type: "tool-call",
          toolCallId: "upstream",
          name: "update_record",
          arguments: "{}",
          executionLocation: "browser",
          targets: [
            { id: targetA, tenantUserId: scope.tenantUserId, clientId: targetA },
            { id: targetB, tenantUserId: other.tenantUserId, clientId: targetB },
          ],
        }),
      }),
    )
    await runtime.runPromise(service.finish({ claim }))
    const newer = await admit(thread.id)
    expect(
      (await runtime.runPromise(service.snapshot({ scope, id: thread.id }))).pending,
    ).toHaveLength(2)
    const result: ChatToolResolution = {
      assistantMessageId: claim.assistantMessageId,
      toolPartId: "019a0800-0000-7000-8000-000000000003",
      responseTargetId: targetA,
      payload: chatTestToolPayload({
        id: "019a0800-0000-7000-8000-000000000004",
        type: "tool-result",
        outcome: "succeeded",
        output: { a: 1, b: 2 },
      }),
    }
    await expect(
      runtime.runPromise(
        service.resolveTools({
          scope,
          id: thread.id,
          clientId: "wrong",
          results: [result],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadForbidden" })
    const first = await runtime.runPromise(
      service.resolveTools({
        scope,
        id: thread.id,
        clientId: targetA,
        results: [result],
      }),
    )
    expect(first.claim).toBeNull()
    const finalResult = {
      scope: other,
      id: thread.id,
      clientId: targetB,
      results: [{ ...result, responseTargetId: targetB }],
    }
    const finalReplies = await Promise.all([
      runtime.runPromise(service.resolveTools(finalResult)),
      runtime.runPromise(service.resolveTools(finalResult)),
    ])
    const second = finalReplies.find((reply) => reply.claim !== null)!
    expect(second.claim).not.toBeNull()
    expect(finalReplies.filter((reply) => reply.claim !== null)).toHaveLength(1)
    expect(second.claim!.inputMessageId).toBe(admitted.inputMessage.id)
    await expect(runtime.runPromise(service.assertActive({ claim }))).rejects.toMatchObject({
      _tag: "ChatThreadConflict",
    })
    await runtime.runPromise(service.interrupt({ claim }))
    await runtime.runPromise(service.assertActive({ claim: second.claim! }))
    expect(second.claim!.invocationId).not.toBe(claim.invocationId)
    await runtime.runPromise(service.assertActive({ claim: newer.claim! }))
    const retry = await runtime.runPromise(
      service.resolveTools({
        scope,
        id: thread.id,
        clientId: targetA,
        results: [
          {
            ...result,
            payload: chatTestToolPayload({
              id: "019a0800-0000-7000-8000-000000000005",
              type: "tool-result",
              outcome: "succeeded",
              output: { b: 2, a: 1 },
            }),
          },
        ],
      }),
    )
    expect(retry.claim).toBeNull()
    await expect(
      runtime.runPromise(
        service.resolveTools({
          scope,
          id: thread.id,
          clientId: targetA,
          results: [
            {
              ...result,
              payload: chatTestToolPayload({
                id: "019a0800-0000-7000-8000-000000000006",
                type: "tool-result",
                output: "changed",
              }),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadConflict" })
    expect(
      (await runtime.runPromise(service.history({ scope, id: thread.id }))).filter(
        (message) => message.role === "tool",
      ),
    ).toHaveLength(2)
    const revision = (await runtime.runPromise(service.get({ scope, id: thread.id }))).lockVersion
    await runtime.runPromise(
      service.setParticipant({
        scope,
        id: thread.id,
        lockVersion: revision,
        tenantUserId: other.tenantUserId,
        role: "viewer",
      }),
    )
    await expect(
      runtime.runPromise(service.assertActive({ claim: second.claim! })),
    ).rejects.toMatchObject({ _tag: "ChatThreadForbidden" })
    expect(
      (
        await runtime.runPromise(
          service.history({ scope, id: thread.id, messageId: admitted.inputMessage.id }),
        )
      ).at(-1)?.turnState,
    ).toBe("interrupted")
    await runtime.runPromise(service.assertActive({ claim: newer.claim! }))
    const current = await runtime.runPromise(service.get({ scope, id: thread.id }))
    await runtime.runPromise(
      service.remove({ scope, id: thread.id, lockVersion: current.lockVersion }),
    )
    expect(
      await db.select().from(chatToolResponse).where(eq(chatToolResponse.threadId, thread.id)),
    ).toEqual([])
    expect(
      await db.select().from(chatMessagePart).where(eq(chatMessagePart.threadId, thread.id)),
    ).toEqual([])
    expect(await db.select().from(chatMessage).where(eq(chatMessage.threadId, thread.id))).toEqual(
      [],
    )
  })

  test("a repeated old result cannot choose the turn resumed by a new result in the same batch", async () => {
    const thread = await create()
    const first = await admit(thread.id)
    const finishCall = async (
      claim: NonNullable<typeof first.claim>,
      target: string,
    ): Promise<ChatToolResolution> => {
      const partId = crypto.randomUUID()
      await runtime.runPromise(
        service.checkpoint({
          claim,
          state: "complete",
          payload: chatTestToolPayload({
            id: partId,
            type: "tool-call",
            toolCallId: target,
            name: "read_value",
            arguments: "{}",
            executionLocation: "browser",
            targets: [{ id: target, tenantUserId: scope.tenantUserId, clientId: targetA }],
          }),
        }),
      )
      await runtime.runPromise(service.finish({ claim }))
      return {
        assistantMessageId: claim.assistantMessageId,
        toolPartId: partId,
        responseTargetId: target,
        payload: chatTestToolPayload({
          id: "019a0800-0000-7000-8000-000000000004",
          type: "tool-result",
          outcome: "succeeded",
          output: target,
        }),
      }
    }
    const oldResult = await finishCall(first.claim!, targetA)
    const resumedFirst = await runtime.runPromise(
      service.resolveTools({
        scope,
        id: thread.id,
        clientId: targetA,
        results: [oldResult],
      }),
    )
    await runtime.runPromise(complete({ claim: resumedFirst.claim!, payload }))
    const second = await admit(thread.id)
    const newResult = await finishCall(second.claim!, targetB)
    const resumed = await runtime.runPromise(
      service.resolveTools({
        scope,
        id: thread.id,
        clientId: targetA,
        results: [oldResult, newResult],
      }),
    )
    expect(resumed.inputMessage.id).toBe(second.inputMessage.id)
    expect(resumed.claim!.inputMessageId).toBe(second.inputMessage.id)
  })

  test.each(["sandbox", "browser"])(
    "unknown %s closure fences an abandoned invocation without accepting fabricated success",
    async (executionLocation) => {
      const thread = await create()
      const admitted = await admit(thread.id)
      const claim = admitted.claim!
      await runtime.runPromise(
        service.checkpoint({
          claim,
          state: "complete",
          payload: chatTestToolPayload({
            id: "019a0800-0000-7000-8000-000000000007",
            type: "tool-call",
            toolCallId: "server",
            name: "sandbox_run_command",
            arguments: "{}",
            executionLocation,
            targets: [
              executionLocation === "browser"
                ? { id: targetA, tenantUserId: scope.tenantUserId, clientId: targetA }
                : { id: targetA },
            ],
          }),
        }),
      )
      const result: ChatToolResolution = {
        assistantMessageId: claim.assistantMessageId,
        toolPartId: "019a0800-0000-7000-8000-000000000007",
        responseTargetId: targetA,
        payload: chatTestToolPayload({
          id: "019a0800-0000-7000-8000-000000000008",
          type: "tool-result",
          outcome: "unknown",
          output: null,
        }),
      }
      await expect(
        runtime.runPromise(
          service.resolveTools({
            scope,
            id: thread.id,
            clientId: "new-tab",
            results: [
              {
                ...result,
                payload: chatTestToolPayload({
                  id: "019a0800-0000-7000-8000-000000000008",
                  type: "tool-result",
                  outcome: "succeeded",
                  output: "fabricated",
                }),
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ _tag: "ChatThreadForbidden" })
      const accepted = await runtime.runPromise(
        service.resolveTools({
          scope,
          id: thread.id,
          clientId: "new-tab",
          results: [result],
        }),
      )
      expect(accepted.claim).not.toBeNull()
      expect(accepted.claim!.invocationId).not.toBe(claim.invocationId)
      await expect(runtime.runPromise(service.assertActive({ claim }))).rejects.toMatchObject({
        _tag: "ChatThreadConflict",
      })
      await runtime.runPromise(service.interrupt({ claim }))
      await runtime.runPromise(service.assertActive({ claim: accepted.claim! }))
      const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
      expect(
        projectChatModelHistory(history).find((message) => message.role === "tool")?.content,
      ).toBe(JSON.stringify({ outcome: "unknown", output: null }))
      expect(
        (await runtime.runPromise(service.snapshot({ scope, id: thread.id }))).pending,
      ).toEqual([])
      const retry = await runtime.runPromise(
        service.resolveTools({
          scope,
          id: thread.id,
          clientId: "new-tab",
          results: [result],
        }),
      )
      expect(retry.claim).toBeNull()
    },
  )

  test("lists by thread updates, including renames, and keeps history readable after its agent is removed", async () => {
    const first = await create()
    const second = await runtime.runPromise(service.create({ scope }))
    const admitted = await admit(first.id)
    const agentId = `agent_${scope.organizationId}_${first.agentId}`
    expect(admitted.assistantMessage!.payload.provenance?.agentId).toBe(agentId)
    await runtime.runPromise(complete({ claim: admitted.claim!, payload }))
    const secondAdmission = await admit(second.id)
    await runtime.runPromise(service.finish({ claim: secondAdmission.claim! }))
    await runtime.runPromise(
      service.rename({ scope, id: second.id, title: "Renamed conversation", lockVersion: 1 }),
    )
    const page = await runtime.runPromise(service.list({ scope, pageSize: 1 }))
    expect(page.items[0]!.id).toBe(second.id)
    expect(
      (await runtime.runPromise(service.list({ scope, pageSize: 1, position: page.nextPosition! })))
        .items[0]!.id,
    ).toBe(first.id)
    await db
      .update(chatThread)
      .set({ agentId: null })
      .where(
        and(
          eq(chatThread.organizationId, scope.organizationId),
          eq(chatThread.agentId, first.agentId!),
        ),
      )
    await db
      .update(organizationConfiguration)
      .set({ defaultAgentId: null })
      .where(eq(organizationConfiguration.organizationId, scope.organizationId))
    await db
      .delete(agent)
      .where(and(eq(agent.organizationId, scope.organizationId), eq(agent.id, first.agentId!)))
    expect((await runtime.runPromise(service.get({ scope, id: first.id }))).agentId).toBeNull()
    const history = await runtime.runPromise(service.history({ scope, id: first.id }))
    expect(history).toHaveLength(2)
    expect(history[1]!.payload).toMatchObject({ version: 1, provenance: { agentId } })
  })

  test("reads only selected ancestors and deletes populated head/parent graphs atomically", async () => {
    const thread = await create()
    const admitted = await admit(thread.id)
    await runtime.runPromise(complete({ claim: admitted.claim!, payload }))
    const continued = await admit(thread.id)
    await runtime.runPromise(
      complete({
        claim: continued.claim!,
        payload: {
          ...payload,
          parts: payload.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        },
      }),
    )
    const [branch] = await db
      .insert(chatMessage)
      .values({
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        threadId: thread.id,
        parentMessageId: admitted.inputMessage.id,
        role: "assistant",
        state: "complete",
        turnMessageId: admitted.inputMessage.id,
        metadata: { version: 1 },
      })
      .returning()
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(history.map((message) => message.id)).not.toContain(branch!.id)
    const { messages: page } = await runtime.runPromise(
      service.snapshot({ scope, id: thread.id, pageSize: 2 }),
    )
    expect(page.items.map((message) => message.id)).toEqual([
      continued.inputMessage.id,
      continued.assistantMessage!.id,
    ])
    const { messages: older } = await runtime.runPromise(
      service.snapshot({ scope, id: thread.id, pageSize: 2, position: page.nextPosition! }),
    )
    expect(older.items.map((message) => message.id)).toEqual([
      admitted.inputMessage.id,
      admitted.assistantMessage!.id,
    ])
    const { messages: newer } = await runtime.runPromise(
      service.snapshot({
        scope,
        id: thread.id,
        pageSize: 2,
        position: older.previousPosition!,
        backward: true,
      }),
    )
    expect(newer.items.map((message) => message.id)).toEqual(
      page.items.map((message) => message.id),
    )
    await expect(
      runtime.runPromise(
        service.snapshot({ scope, id: thread.id, position: { id: crypto.randomUUID() } }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    await runtime.runPromise(service.remove({ scope, id: thread.id, lockVersion: 2 }))
    expect(await db.select().from(chatMessage).where(eq(chatMessage.threadId, thread.id))).toEqual(
      [],
    )
    await expect(
      runtime.runPromise(service.assertActive({ claim: admitted.claim! })),
    ).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
  })

  test("thread activity cursors survive boundary updates and deletion", async () => {
    const ids: string[] = []
    for (let index = 0; index < 3; index++) {
      const thread = await create()
      const admitted = await admit(thread.id)
      await runtime.runPromise(
        complete({
          claim: admitted.claim!,
          payload: {
            version: 1,
            parts: [{ id: crypto.randomUUID(), type: "text", content: "Answer" }],
          },
        }),
      )
      ids.unshift(thread.id)
    }
    const first = await runtime.runPromise(service.list({ scope, pageSize: 1 }))
    expect(first.items[0]!.id).toBe(ids[0])
    await runtime.runPromise(
      service.rename({ scope, id: ids[0]!, title: "Updated boundary", lockVersion: 1 }),
    )
    expect(
      (await runtime.runPromise(service.list({ scope, position: first.nextPosition! }))).items.map(
        (row) => row.id,
      ),
    ).toEqual(ids.slice(1))
    await runtime.runPromise(service.remove({ scope, id: ids[0]!, lockVersion: 2 }))
    expect(
      (await runtime.runPromise(service.list({ scope, position: first.nextPosition! }))).items.map(
        (row) => row.id,
      ),
    ).toEqual(ids.slice(1))
  })

  test("stores two client response slots for one participant and validates normalized JSON on relational reads", async () => {
    const thread = await create()
    const accepted = await admit(thread.id)
    const partId = crypto.randomUUID()
    const decision: ChatMessagePayload = chatTestToolPayload({
      id: partId,
      type: "tool-call",
      toolCallId: "upstream",
      name: "update_record",
      arguments: "{}",
      executionLocation: "browser",
      targets: [targetA, targetB].map((clientId) => ({
        id: clientId,
        clientId,
        tenantUserId: scope.tenantUserId,
      })),
    })
    await runtime.runPromise(
      service.checkpoint({ claim: accepted.claim!, payload: decision, state: "complete" }),
    )
    await runtime.runPromise(service.finish({ claim: accepted.claim! }))
    const separate = await runtime.runPromise(service.create({ scope: other }))
    const messages = await db.select().from(chatMessage).where(eq(chatMessage.threadId, thread.id))
    const parts = await db
      .select()
      .from(chatMessagePart)
      .where(eq(chatMessagePart.threadId, thread.id))
    await db.insert(chatMessage).values(messages.map((row) => ({ ...row, threadId: separate.id })))
    await db.insert(chatMessagePart).values(parts.map((row) => ({ ...row, threadId: separate.id })))
    const pending = (await runtime.runPromise(service.snapshot({ scope, id: thread.id }))).pending
    expect(pending).toHaveLength(2)
    expect(pending.map(({ target }) => target.id)).toEqual(
      expect.arrayContaining([targetA, targetB]),
    )
    expect(pending.every(({ message }) => message.threadId === thread.id)).toBe(true)
    const restored = await db.query.chatMessage.findFirst({
      where: { threadId: thread.id, id: accepted.assistantMessage!.id },
      with: { parts: { with: { responses: true } } },
    })
    expect(restored!.parts[0]!.responses).toHaveLength(2)
    await expect(
      db
        .update(chatMessage)
        .set({ metadata: { version: 2 } as unknown as typeof chatMessage.$inferInsert.metadata })
        .where(eq(chatMessage.id, accepted.inputMessage.id)),
    ).rejects.toThrow()
    await db.execute(
      sql`update chat_message_part set payload = '{"version":2,"type":"text","content":"unsupported"}'::jsonb, execution_location = null, updated_at = now() where thread_id = ${thread.id} and id = ${partId}`,
    )
    await expect(
      db.select().from(chatMessagePart).where(eq(chatMessagePart.id, partId)),
    ).rejects.toThrow()
    await expect(
      db.query.chatMessage.findFirst({
        where: { threadId: thread.id, id: accepted.assistantMessage!.id },
        with: { parts: true },
      }),
    ).rejects.toThrow()
  })
})
