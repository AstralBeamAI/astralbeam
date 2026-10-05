import { and, eq, sql } from "drizzle-orm"
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

import { Database, getAuthDatabase } from "@/db/database.server"
import { cacheEntry } from "@/db/schema/cache.server"
import { Agents } from "@/lib/agents/agents.server"
import { prepareManagedChat } from "./commands.server"
import type { ChatParams } from "../types"
import {
  agent,
  chatThread,
  chatMessage,
  chatMessagePart,
  chatToolResponse,
  organization,
  organizationConfiguration,
  tenant,
  tenantUser,
} from "@/db/schema.server"
import { ChatThreads } from "./threads.server"
import { projectChatModelHistory } from "./projection.server"
import type { ChatThreadScope, ChatMessagePayload, ChatToolResolution } from "./schemas"

const payload: ChatMessagePayload = {
  version: 1,
  parts: [{ id: "019a0800-0000-7000-8000-000000000001", type: "text", content: "Hello" }],
}
const targetA = "019a0700-0000-7000-8000-000000000001"
const targetB = "019a0700-0000-7000-8000-000000000002"

const runtime = ManagedRuntime.make(Layer.mergeAll(Database.layer, ChatThreads.layer))

describe.skipIf(!integration.url)("PostgreSQL chat conversations", () => {
  let db: ReturnType<typeof getAuthDatabase>
  let service: Effect.Success<typeof ChatThreads>
  let scope: ChatThreadScope
  let other: ChatThreadScope
  let foreign: ChatThreadScope

  beforeAll(async () => {
    db = getAuthDatabase()
    service = await runtime.runPromise(ChatThreads)
  })
  afterAll(async () => {
    await runtime.dispose()
  })
  beforeEach(async () => {
    await db.execute(sql`truncate organization cascade`)
    const [org] = await db.insert(organization).values({ name: "Chat", slug: "chat" }).returning()
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

  test("replays admission receipts, reauthorizes retries, and purges retained input on deletion", async () => {
    const thread = await create()
    const params: ChatParams = {
      threadId: thread.id,
      runId: "first-run",
      messages: [{ role: "user" as const, content: "Hello" }],
      tools: [],
      context: [],
      aguiContext: [],
      state: undefined,
      forwardedProps: { clientId: targetA },
    }
    const request = { scope, params, idempotencyKey: "same-intent" }
    const run = (input: typeof request, threads = service) =>
      runtime.runPromise(
        prepareManagedChat(input).pipe(
          Effect.provideService(Agents, {
            resolveForChat: () =>
              Effect.succeed({ attachmentsEnabled: true, sandboxProviderId: null }),
          } as unknown as typeof Agents.Service),
          Effect.provideService(ChatThreads, threads),
        ),
      )
    const first = await run(request)
    expect(first.admission?.claim).toBeTruthy()
    await db.update(chatThread).set({ agentId: null }).where(eq(chatThread.id, thread.id))
    const retry = await run({ ...request, params: { ...params, runId: "retry-run" } })
    expect(retry.admission).toBeUndefined()
    expect(retry.receipt).toEqual(first.receipt)
    await expect(
      run({
        ...request,
        params: { ...params, forwardedProps: { ...params.forwardedProps, agentId: "changed" } },
      }),
    ).rejects.toMatchObject({ _tag: "IdempotencyParametersMismatch" })
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
    expect(await run(request)).toMatchObject({ admission: undefined, receipt: first.receipt })
    await expect(run({ ...request, idempotencyKey: "new-intent" })).rejects.toMatchObject({
      _tag: "ChatThreadForbidden",
    })
    expect(
      await db
        .select()
        .from(cacheEntry)
        .where(eq(cacheEntry.namespace, `chat:${thread.id}`)),
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
        .where(eq(cacheEntry.namespace, `chat:${thread.id}`)),
    ).toEqual([])
    await expect(run(request)).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    const deleted = await create()
    await expect(
      run(
        { ...request, params: { ...params, threadId: deleted.id } },
        {
          ...service,
          get: (input) =>
            service.get(input).pipe(
              Effect.tap(() =>
                service.remove({
                  scope,
                  id: deleted.id,
                  lockVersion: 0,
                }),
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadNotFound" })
    expect(
      await db
        .select()
        .from(cacheEntry)
        .where(eq(cacheEntry.namespace, `chat:${deleted.id}`)),
    ).toEqual([])
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
    expect(
      (
        await runtime.runPromise(
          service
            .resolveScope({
              principal: {
                organization: { id: scope.organizationId },
                tenantUser: { id: "missing", tenant: { id: "same" } },
              },
            })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatIdentityNotSynchronized")
    const thread = await create()
    expect(
      (await runtime.runPromise(service.get({ scope: other, id: thread.id }).pipe(Effect.flip)))
        ._tag,
    ).toBe("ChatThreadNotFound")
    expect(
      (
        await runtime.runPromise(
          service
            .setParticipant({
              scope,
              id: thread.id,
              lockVersion: 0,
              tenantUserId: foreign.tenantUserId,
              role: "member",
            })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadNotFound")
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
    expect(
      (
        await runtime.runPromise(
          service
            .admit({
              scope: other,
              id: thread.id,
              payload,
            })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadForbidden")
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
    await runtime.runPromise(service.finish({ claim: claimed, payload: answer }))
    const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
    expect(history.map((message) => message.state)).toEqual(["complete", "complete"])
    expect(history[1]!.metadata.invocationId).toBe(claimed.invocationId)
    expect(history[1]!.payload.modelMessages).toEqual(answer.modelMessages)
    expect(
      (
        await runtime.runPromise(
          service.checkpoint({ claim: claimed, payload, state: "draft" }).pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadConflict")
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
      service.admit({
        scope,
        id: thread.id,
        payload: {
          version: 1,
          parts: [
            {
              id: crypto.randomUUID(),
              type: "document",
              source: { type: "data", value: file.toString("base64"), mimeType: "application/pdf" },
            },
          ],
        },
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
      service.finish({
        claim: second.claim!,
        payload: {
          ...payload,
          parts: payload.parts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        },
      }),
    )
    await runtime.runPromise(service.finish({ claim: first.claim!, payload }))
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
      expect(
        (await runtime.runPromise(service.finish({ claim: first.claim! }).pipe(Effect.flip)))._tag,
      ).toBe("ChatThreadConflict")
      await runtime.runPromise(service.interrupt({ claim: first.claim! }))
      await runtime.runPromise(service.assertActive({ claim: next }))
    }
    await runtime.runPromise(service.finish({ claim: next }))
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
      service.finish({
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
    expect(
      (await runtime.runPromise(service.assertActive({ claim: next.claim! }).pipe(Effect.flip)))
        ._tag,
    ).toBe("ChatThreadNotFound")
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
    expect(
      (await runtime.runPromise(service.assertActive({ claim: next.claim! }).pipe(Effect.flip)))
        ._tag,
    ).toBe("ChatThreadConflict")

    expect(
      (
        await runtime.runPromise(
          service
            .removeParticipant({
              scope: other,
              id: thread.id,
              lockVersion: 5,
              tenantUserId: other.tenantUserId,
            })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadConflict")
    expect(
      (await runtime.runPromise(service.history({ scope: other, id: thread.id }))).find(
        (message) => message.id === next.assistantMessage!.id,
      )!.state,
    ).toBe("interrupted")
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
        payload: {
          version: 1,
          parts: [
            {
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
            },
          ],
        },
      }),
    )
    await runtime.runPromise(service.finish({ claim }))
    const newer = await admit(thread.id)
    expect(await runtime.runPromise(service.pending({ scope, id: thread.id }))).toHaveLength(2)
    const result: ChatToolResolution = {
      assistantMessageId: claim.assistantMessageId,
      toolPartId: "019a0800-0000-7000-8000-000000000003",
      responseTargetId: targetA,
      payload: {
        version: 1,
        parts: [
          {
            id: "019a0800-0000-7000-8000-000000000004",
            type: "tool-result",
            outcome: "succeeded",
            output: { a: 1, b: 2 },
          },
        ],
      },
    }
    expect(
      (
        await runtime.runPromise(
          service
            .resolveTools({
              scope,
              id: thread.id,
              clientId: "wrong",
              results: [result],
            })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadForbidden")
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
    expect((await runtime.runPromise(service.assertActive({ claim }).pipe(Effect.flip)))._tag).toBe(
      "ChatThreadConflict",
    )
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
            payload: {
              version: 1,
              parts: [
                {
                  id: "019a0800-0000-7000-8000-000000000005",
                  type: "tool-result",
                  outcome: "succeeded",
                  output: { b: 2, a: 1 },
                },
              ],
            },
          },
        ],
      }),
    )
    expect(retry.claim).toBeNull()
    expect(
      (
        await runtime.runPromise(
          service
            .resolveTools({
              scope,
              id: thread.id,
              clientId: targetA,
              results: [
                {
                  ...result,
                  payload: {
                    version: 1,
                    parts: [
                      {
                        id: "019a0800-0000-7000-8000-000000000006",
                        type: "tool-result",
                        output: "changed",
                      },
                    ],
                  },
                },
              ],
            })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadConflict")
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
    expect(
      (await runtime.runPromise(service.assertActive({ claim: second.claim! }).pipe(Effect.flip)))
        ._tag,
    ).toBe("ChatThreadForbidden")
    expect(
      (
        await runtime.runPromise(
          service.getMessage({ scope, id: thread.id, messageId: admitted.inputMessage.id }),
        )
      ).turnState,
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
          payload: {
            version: 1,
            parts: [
              {
                id: partId,
                type: "tool-call",
                toolCallId: target,
                name: "read_value",
                arguments: "{}",
                executionLocation: "browser",
                targets: [{ id: target, tenantUserId: scope.tenantUserId, clientId: targetA }],
              },
            ],
          },
        }),
      )
      await runtime.runPromise(service.finish({ claim }))
      return {
        assistantMessageId: claim.assistantMessageId,
        toolPartId: partId,
        responseTargetId: target,
        payload: {
          version: 1,
          parts: [
            {
              id: "019a0800-0000-7000-8000-000000000004",
              type: "tool-result",
              outcome: "succeeded",
              output: target,
            },
          ],
        },
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
    await runtime.runPromise(service.finish({ claim: resumedFirst.claim!, payload }))
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
          payload: {
            version: 1,
            parts: [
              {
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
              },
            ],
          },
        }),
      )
      const result: ChatToolResolution = {
        assistantMessageId: claim.assistantMessageId,
        toolPartId: "019a0800-0000-7000-8000-000000000007",
        responseTargetId: targetA,
        payload: {
          version: 1,
          parts: [
            {
              id: "019a0800-0000-7000-8000-000000000008",
              type: "tool-result",
              outcome: "unknown",
              output: null,
            },
          ],
        },
      }
      expect(
        (
          await runtime.runPromise(
            service
              .resolveTools({
                scope,
                id: thread.id,
                clientId: "new-tab",
                results: [
                  {
                    ...result,
                    payload: {
                      version: 1,
                      parts: [
                        {
                          id: "019a0800-0000-7000-8000-000000000008",
                          type: "tool-result",
                          outcome: "succeeded",
                          output: "fabricated",
                        },
                      ],
                    },
                  },
                ],
              })
              .pipe(Effect.flip),
          )
        )._tag,
      ).toBe("ChatThreadForbidden")
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
      expect(
        (await runtime.runPromise(service.assertActive({ claim }).pipe(Effect.flip)))._tag,
      ).toBe("ChatThreadConflict")
      await runtime.runPromise(service.interrupt({ claim }))
      await runtime.runPromise(service.assertActive({ claim: accepted.claim! }))
      const history = await runtime.runPromise(service.history({ scope, id: thread.id }))
      const savedResult = history.find((message) => message.role === "tool")!
      expect(savedResult.payload.parts[0]!.content).toBe(
        JSON.stringify({ outcome: "unknown", output: null }),
      )
      expect(
        projectChatModelHistory(history).find((message) => message.role === "tool")?.content,
      ).toBe(savedResult.payload.parts[0]!.content)
      expect(await runtime.runPromise(service.pending({ scope, id: thread.id }))).toEqual([])
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
    await runtime.runPromise(service.finish({ claim: admitted.claim!, payload }))
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
    await runtime.runPromise(service.finish({ claim: admitted.claim!, payload }))
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
      service.snapshot({ scope, id: thread.id, pageSize: 1 }),
    )
    expect(page.items[0]!.id).toBe(admitted.assistantMessage!.id)
    const { messages: older } = await runtime.runPromise(
      service.snapshot({ scope, id: thread.id, pageSize: 1, position: page.nextPosition! }),
    )
    expect(older.items[0]!.id).toBe(admitted.inputMessage.id)
    const { messages: newer } = await runtime.runPromise(
      service.snapshot({
        scope,
        id: thread.id,
        pageSize: 1,
        position: older.previousPosition!,
        backward: true,
      }),
    )
    expect(newer.items[0]!.id).toBe(admitted.assistantMessage!.id)
    expect(
      (
        await runtime.runPromise(
          service
            .snapshot({ scope, id: thread.id, position: { id: crypto.randomUUID() } })
            .pipe(Effect.flip),
        )
      )._tag,
    ).toBe("ChatThreadNotFound")
    await runtime.runPromise(service.remove({ scope, id: thread.id, lockVersion: 1 }))
    expect(await db.select().from(chatMessage).where(eq(chatMessage.threadId, thread.id))).toEqual(
      [],
    )
    expect(
      (await runtime.runPromise(service.assertActive({ claim: admitted.claim! }).pipe(Effect.flip)))
        ._tag,
    ).toBe("ChatThreadNotFound")
  })

  test("thread activity cursors survive boundary updates and deletion", async () => {
    const ids: string[] = []
    for (let index = 0; index < 3; index++) {
      const thread = await create()
      const admitted = await admit(thread.id)
      await runtime.runPromise(
        service.finish({
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

  test("a history page decodes only its selected content", async () => {
    const thread = await create()
    for (let index = 0; index < 4; index++) {
      const admitted = await admit(thread.id)
      await runtime.runPromise(
        service.finish({
          claim: admitted.claim!,
          payload: {
            version: 1,
            parts: [{ id: crypto.randomUUID(), type: "text", content: "Answer" }],
          },
        }),
      )
    }
    const decode = vi.spyOn(chatMessagePart.payload, "mapFromDriverValue")
    try {
      const snapshot = await runtime.runPromise(
        service.snapshot({ scope, id: thread.id, pageSize: 1 }),
      )
      expect(snapshot.messages.items).toHaveLength(1)
      expect(decode).toHaveBeenCalledTimes(1)
    } finally {
      decode.mockRestore()
    }
  })

  test("database constraints reject an author from another Tenant", async () => {
    const thread = await create()
    await expect(
      db.insert(chatMessage).values({
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        threadId: thread.id,
        role: "user",
        state: "complete",
        turnState: "completed",
        authorTenantUserId: foreign.tenantUserId,
        metadata: { version: 1 },
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } })
  })

  test("stores two client response slots for one participant and validates normalized JSON on relational reads", async () => {
    const thread = await create()
    const accepted = await admit(thread.id)
    const partId = crypto.randomUUID()
    const decision: ChatMessagePayload = {
      version: 1,
      parts: [
        {
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
        },
      ],
    }
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
    const pending = await runtime.runPromise(service.pending({ scope, id: thread.id }))
    expect(pending).toHaveLength(2)
    expect(pending.map(({ target }) => target.id)).toEqual(
      expect.arrayContaining([targetA, targetB]),
    )
    expect(pending.every(({ message }) => message.threadId === thread.id)).toBe(true)
    const rows = await db
      .select()
      .from(chatToolResponse)
      .where(eq(chatToolResponse.toolPartId, partId))
    expect(rows.map((row) => row.clientId).sort((a, b) => a!.localeCompare(b!))).toEqual([
      targetA,
      targetB,
    ])
    expect(
      rows.every((row) => row.tenantUserId === scope.tenantUserId && row.resultMessageId === null),
    ).toBe(true)
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
    await runtime.runPromise(service.remove({ scope, id: thread.id, lockVersion: 1 }))
    expect(
      await db.select().from(chatToolResponse).where(eq(chatToolResponse.toolPartId, partId)),
    ).toEqual([])
  })
})
