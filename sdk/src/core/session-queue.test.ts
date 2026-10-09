import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createAstralBeamChat } from "./session.ts"

const threadId = "019a0700-0000-7000-8000-000000000001"
const turnId = "019a0700-0000-7000-8000-000000000002"
const user = {
  scope: "tenant",
  organization: { id: "org" },
  tenant: { id: "tenant" },
  user: { id: "user" },
}
const token = () => ({
  token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
})
const thread = {
  id: threadId,
  title: "Queue",
  agent_id: "agent",
  role: "manager",
  version: 1,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
}
const options = { threadId, fetchAstralBeamToken: token }
const history = (messages: object[] = []) =>
  Response.json({ thread, messages, pending_interactions: [], page_after: null, page_before: null })
const encode = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
const rejected = (status: number, detail: string) =>
  Response.json({ type: "about:blank", status, title: "Rejected", detail }, { status })

function network(announceTurn = true) {
  const requests: Array<{ key: string | null; body: { messages: unknown[] } }> = []
  const steering: Array<{ key: string | null; body: unknown }> = []
  let controller: ReadableStreamDefaultController<Uint8Array>
  let followupResponse = () =>
    Promise.resolve(
      Response.json({
        thread_id: threadId,
        accepted_message_id: `input-${requests.length}`,
        thread_version: 4,
      }),
    )
  let historyResponse = () => Promise.resolve(history())
  let steeringResponse = () =>
    Promise.resolve(
      Response.json({ thread_id: threadId, accepted_message_id: "guidance", thread_version: 2 }),
    )
  const emit = (event: object) => controller.enqueue(encode(event))
  const announce = () =>
    emit({
      type: "CUSTOM",
      name: "astralbeam_thread",
      value: {
        threadId,
        turnMessageId: turnId,
        turnState: "running",
        acceptedMessageId: turnId,
        version: 2,
      },
    })
  const finish = () => {
    emit({
      type: "CUSTOM",
      name: "astralbeam_thread",
      value: { threadId, turnMessageId: turnId, turnState: "completed", version: 3, saved: true },
    })
    emit({ type: "TEXT_MESSAGE_END", messageId: "answer" })
    emit({ type: "RUN_FINISHED", threadId, runId: "run" })
    controller.close()
  }
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return Promise.resolve(Response.json(user))
    if (path.endsWith("/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.endsWith("/messages")) return historyResponse()
    if (path.endsWith("/steer")) {
      steering.push({
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: JSON.parse(init!.body as string) as unknown,
      })
      return steeringResponse()
    }
    if (path.endsWith("/chat")) {
      requests.push({
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: JSON.parse(init!.body as string) as (typeof requests)[number]["body"],
      })
      if (requests.length > 1) return followupResponse()
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(next) {
              controller = next
              emit({ type: "RUN_STARTED", threadId, runId: "run" })
              if (announceTurn) announce()
              emit({ type: "TEXT_MESSAGE_START", messageId: "answer", role: "assistant" })
              emit({ type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: "Working" })
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      )
    }
    return Promise.reject(new Error(`Unexpected request ${path}`))
  })
  return {
    requests,
    steering,
    emit,
    finish,
    announce,
    setFollowupResponse: (next: typeof followupResponse) => {
      followupResponse = next
    },
    setHistoryResponse: (next: typeof historyResponse) => {
      historyResponse = next
    },
    setSteeringResponse: (next: typeof steeringResponse) => {
      steeringResponse = next
    },
  }
}

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => vi.unstubAllGlobals())

test("explicit resume during hydration drains after the page is applied", async () => {
  const net = network()
  let release!: (response: Response) => void
  net.setHistoryResponse(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const chat = createAstralBeamChat(options)
  try {
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    await chat.sendMessage("After hydration")
    await chat.resumeQueue()
    expect(net.requests).toHaveLength(0)
    net.setHistoryResponse(() => Promise.resolve(history()))
    release(history())
    await vi.waitFor(() => expect(net.requests).toHaveLength(1))
    net.finish()
    await vi.waitFor(() => expect(chat.getState().pendingMessages).toEqual([]))
  } finally {
    chat.dispose()
  }
})

test("busy sends retain FIFO and receipts while editing holds delivery after completion", async () => {
  const net = network()
  const chat = createAstralBeamChat(options)
  const accepted = vi.fn()
  const queued = vi.fn()
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadId))
    const active = chat.sendMessage("First")
    await vi.waitFor(() => expect(chat.getState().status).toBe("streaming"))
    await chat.sendMessage("Second", { onQueued: queued, onAccepted: accepted })
    await chat.sendMessage("Third", { onQueued: queued, onAccepted: accepted })
    expect(queued).toHaveBeenCalledTimes(2)
    expect(accepted).not.toHaveBeenCalled()
    expect(net.requests).toHaveLength(1)
    const release = chat.holdQueue()
    const second = chat.getState().pendingMessages[0]!
    net.finish()
    await active
    expect(net.requests).toHaveLength(1)
    await chat.sendMessage("Fourth", { onQueued: queued, onAccepted: accepted })
    expect(queued).toHaveBeenCalledTimes(3)
    expect(chat.editPendingMessage(second.id, "Second edited")).toBe(true)
    chat.stop()
    release()
    expect(net.requests).toHaveLength(1)
    await chat.resumeQueue()
    await vi.waitFor(() => expect(chat.getState().pendingMessages).toEqual([]))
    expect(net.requests.map((request) => JSON.stringify(request.body.messages))).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second edited"),
      expect.stringContaining("Third"),
      expect.stringContaining("Fourth"),
    ])
    expect(new Set(net.requests.map((request) => request.key)).size).toBe(4)
    expect(accepted).toHaveBeenCalledTimes(3)
  } finally {
    chat.dispose()
  }
})

test.each(["accepted", "finished"])(
  "steering %s preserves the active stream and falls back only after definite rejection",
  async (outcome) => {
    const net = network(false)
    net.setHistoryResponse(() =>
      Promise.resolve(
        history([
          {
            id: "previous",
            role: "user",
            turn_state: "completed",
            turn_message_id: null,
            author_tenant_user_id: "user",
            parts: [],
          },
        ]),
      ),
    )
    let release!: (response: Response) => void
    if (outcome === "finished")
      net.setSteeringResponse(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
    const chat = createAstralBeamChat(options)
    const accepted = vi.fn()
    try {
      await vi.waitFor(() => expect(chat.getState().activeTurnId).toBe("previous"))
      const active = chat.sendMessage("First")
      await vi.waitFor(() => expect(chat.getState().status).toBe("streaming"))
      expect(chat.getState().activeTurnId).toBeUndefined()
      await chat.sendMessage(
        "Use the blue option",
        {
          onAccepted: accepted,
          onQueued: () => {
            throw new Error("Host callback failed")
          },
        },
        { whenBusy: "steer" },
      )
      expect(net.steering).toHaveLength(0)
      const pending = chat.getState().pendingMessages.at(-1)!
      net.announce()
      await vi.waitFor(() => expect(chat.getState().activeTurnId).toBe(turnId))
      const steered = chat.steerPendingMessage(pending.id)
      await vi.waitFor(() => expect(net.steering).toHaveLength(1))
      if (outcome === "finished") {
        net.finish()
        await vi.waitUntil(() => chat.getState().status === "ready")
        release(rejected(409, "This turn has finished. Queue your message as a new turn"))
      }
      await steered
      expect(net.steering[0]?.body).toMatchObject({
        turn_message_id: turnId,
        parts: [{ type: "text", content: "Use the blue option" }],
      })
      if (outcome === "accepted")
        net.emit({
          type: "CUSTOM",
          name: "astralbeam_thread",
          value: { threadId, appliedSteeringMessageIds: ["guidance"] },
        })
      if (outcome === "accepted") net.finish()
      await active
      await chat.resumeQueue()
      expect(net.steering).toHaveLength(1)
      expect(net.requests).toHaveLength(outcome === "accepted" ? 1 : 2)
      expect(accepted).toHaveBeenCalledOnce()
      expect(net.requests[1]?.key).not.toBe(net.steering[0]?.key)
      expect(chat.getState().pendingMessages).toEqual([])
    } finally {
      chat.dispose()
    }
  },
)

test("reload pauses text recovery, retains steering receipt keys, and blocks missing attachments", async () => {
  const net = network()
  net.setSteeringResponse(() => Promise.reject(new TypeError("Lost acknowledgement")))
  const chat = createAstralBeamChat(options)
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadId))
  const active = chat.sendMessage("First")
  await vi.waitFor(() => expect(chat.getState().status).toBe("streaming"))
  await chat.sendMessage(
    {
      content: [
        { type: "text", content: "Guidance" },
        { type: "text", content: "Use blue" },
      ],
    },
    undefined,
    { whenBusy: "steer" },
  )
  await chat.sendMessage({
    content: [
      { type: "text", content: "Read this" },
      { type: "document", source: { type: "data", value: "SGVsbG8=", mimeType: "text/plain" } },
    ],
  })
  chat.dispose()
  net.finish()
  await active
  net.setSteeringResponse(() => Promise.resolve(rejected(429, "Try later")))
  const restored = createAstralBeamChat(options)
  try {
    await vi.waitFor(() => expect(restored.getState().thread?.id).toBe(threadId))
    expect(restored.getState().queuePaused).toBe(true)
    expect(net.steering).toHaveLength(1)
    expect(restored.getState().pendingMessages[1]).toMatchObject({
      content: { content: [{ type: "text", content: "Read this" }] },
      attachmentsRequired: true,
    })
    await restored.resumeQueue()
    expect(restored.getState().pendingMessages[0]?.status).toBe("sending")
    net.setSteeringResponse(() =>
      Promise.resolve(
        Response.json({ thread_id: threadId, accepted_message_id: "guidance", thread_version: 2 }),
      ),
    )
    await restored.resumeQueue()
    expect(net.steering).toHaveLength(3)
    expect(net.steering[2]?.key).toBe(net.steering[0]?.key)
    expect(net.steering[2]?.body).toEqual(net.steering[0]?.body)
    expect(net.requests).toHaveLength(1)
    const file = restored.getState().pendingMessages.find((entry) => entry.attachmentsRequired)!
    restored.editPendingMessage(file.id, "Edited text")
    expect(
      restored.getState().pendingMessages.find((entry) => entry.id === file.id)
        ?.attachmentsRequired,
    ).toBe(true)
  } finally {
    restored.dispose()
  }
})

test("rejected queued text survives reload and remains editable before FIFO resumes", async () => {
  const net = network()
  net.setFollowupResponse(() => Promise.resolve(rejected(429, "Try later")))
  const chat = createAstralBeamChat(options)
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadId))
  const active = chat.sendMessage("First")
  await vi.waitFor(() => expect(chat.getState().status).toBe("streaming"))
  await chat.sendMessage("Second")
  await chat.sendMessage("Third")
  net.finish()
  await active
  expect(chat.getState().pendingMessages[0]).toMatchObject({ content: "Second", status: "queued" })
  chat.dispose()
  net.setFollowupResponse(() =>
    Promise.resolve(
      Response.json({
        thread_id: threadId,
        accepted_message_id: "followup",
        thread_version: 4,
      }),
    ),
  )
  const restored = createAstralBeamChat(options)
  try {
    await vi.waitFor(() => expect(restored.getState().thread?.id).toBe(threadId))
    expect(net.requests).toHaveLength(2)
    expect(
      restored.editPendingMessage(restored.getState().pendingMessages[0]!.id, "Second edited"),
    ).toBe(true)
    await restored.resumeQueue()
    expect(net.requests.map((request) => JSON.stringify(request.body.messages))).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("Second edited"),
      expect.stringContaining("Third"),
    ])
    expect(restored.getState().pendingMessages).toEqual([])
  } finally {
    restored.dispose()
  }
})
