import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createAstralBeamChat } from "./session.ts"

const threadA = "00000000-0000-4000-8000-000000000001"
const threadB = "00000000-0000-4000-8000-000000000002"
const currentUser = {
  scope: "tenant",
  organization: { id: "organization" },
  tenant: { id: "tenant" },
  user: { id: "user" },
}
const token = () => ({
  token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
})
const thread = (id: string) => ({
  id,
  title: "Saved conversation",
  agent_id: "saved-agent",
  version: 1,
  role: "manager",
  writer_active: false,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
})
const page = (id: string) => ({
  thread: thread(id),
  messages: [],
  pending_interactions: [],
  page_after: null,
  page_before: null,
})

beforeEach(() => vi.stubGlobal("sessionStorage", undefined))
afterEach(() => vi.unstubAllGlobals())

test.each(["selection", "api", "identity"] as const)(
  "%s changes preserve uncertain submissions only within the same authenticated scope",
  async (change) => {
    let user = currentUser
    const onThreadReady = vi.fn()
    const onAccepted = vi.fn()
    const sent: Array<{
      key: string | null
      body: { runId?: string; messages: unknown[]; tools: unknown[] }
    }> = []
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(user))
      if (url.pathname.endsWith("/chat/config"))
        return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
      if (url.pathname.endsWith("/messages")) {
        const id = url.pathname.split("/").at(-2)!
        return Promise.resolve(Response.json(page(id)))
      }
      if (url.pathname.endsWith("/threads"))
        return Promise.resolve(
          Response.json({
            items: [thread(threadA), thread(threadB)],
            page_after: null,
            page_before: null,
          }),
        )
      if (url.pathname.endsWith("/chat")) {
        if (typeof init?.body !== "string") throw new Error("Expected an AG-UI request body")
        const body = JSON.parse(init.body) as (typeof sent)[number]["body"]
        sent.push({ key: new Headers(init.headers).get("Idempotency-Key"), body })
        if (sent.length === 1)
          return Promise.reject(new TypeError("Connection lost after admission"))
        return Promise.resolve(
          new Response(
            [
              { type: "RUN_STARTED", threadId: threadA, runId: "run" },
              {
                type: "CUSTOM",
                name: "astralbeam_thread",
                value: { threadId: threadA, version: 2, acceptedMessageId: "accepted" },
              },
              { type: "RUN_FINISHED", threadId: threadA, runId: "run" },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        )
      }
      return Promise.reject(new Error(`Unexpected request ${url}`))
    })
    const chat = createAstralBeamChat({
      threadId: threadA,
      fetchAstralBeamToken: token,
    })
    try {
      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
      await chat.sendMessage("Keep my original intent", { onThreadReady, onAccepted })
      expect(onThreadReady).toHaveBeenCalledWith(threadA)
      expect(onAccepted).not.toHaveBeenCalled()
      expect(chat.getState().unsentMessage).toBe("Keep my original intent")
      await chat.openThread(threadB)
      expect(chat.getState().unsentMessage).toBeUndefined()

      if (change === "api") chat.updateOptions({ apiUrl: "https://replacement.example/api" })
      else if (change === "identity") {
        user = { ...currentUser, user: { id: "another-user" } }
        chat.retryAuthentication()
      } else await chat.openThread(threadA)

      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
      expect(chat.getState().unsentMessage).toBe(
        change === "selection" ? "Keep my original intent" : undefined,
      )
      await chat.reload()
      expect(sent).toHaveLength(1)
      await chat.sendMessage("Keep my original intent")
      expect(sent).toHaveLength(2)
      expect(sent[0]?.key).toBeTruthy()
      expect(sent[1]?.key === sent[0]?.key).toBe(change === "selection")
      expect(chat.getState().unsentMessage).toBeUndefined()
      expect(chat.getState().error).toBeUndefined()
      expect(onAccepted).toHaveBeenCalledTimes(change === "selection" ? 1 : 0)
    } finally {
      chat.dispose()
    }
  },
)

test("a send awaiting authentication cannot follow the user into a new conversation", async () => {
  const mutations: string[] = []
  const onThreadReady = vi.fn()
  const onAccepted = vi.fn()
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (init?.method === "POST") mutations.push(url.pathname)
    if (url.pathname.endsWith("/messages")) return Promise.resolve(Response.json(page(threadA)))
    if (url.pathname.endsWith("/threads"))
      return Promise.resolve(
        Response.json({
          items: [thread(threadA)],
          page_after: null,
          page_before: null,
        }),
      )
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: threadA,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
    const send = chat.sendMessage("Only for conversation A", { onThreadReady, onAccepted })
    chat.reset()
    await send
    expect(mutations).toEqual([])
    expect(chat.getState().thread).toBeUndefined()
    expect(chat.getState().unsentMessage).toBeUndefined()
    expect(chat.getState().error).toBeUndefined()
    expect(onThreadReady).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
  } finally {
    chat.dispose()
  }
})

test("new-conversation callbacks identify the destination and acknowledge input before streaming ends", async () => {
  const onThreadReady = vi.fn<(id: string) => void>()
  const onAccepted = vi.fn()
  const settled = vi.fn()
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const response = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller
    },
    cancel() {
      stream = undefined
    },
  })
  const sent: Array<{ threadId: string; destination: string | undefined }> = []
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (url.pathname.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (url.pathname.endsWith("/threads"))
      return Promise.resolve(
        Response.json(
          init?.method === "POST"
            ? thread(threadA)
            : { items: [], page_after: null, page_before: null },
        ),
      )
    if (url.pathname.endsWith("/messages"))
      return Promise.resolve(
        Response.json({
          thread: thread(threadA),
          messages: [],
          pending_interactions: [],
          page_after: null,
          page_before: null,
        }),
      )
    if (url.pathname.endsWith("/chat")) {
      if (typeof init?.body !== "string") throw new Error("Expected an AG-UI request body")
      const body = JSON.parse(init.body) as { threadId: string }
      sent.push({ threadId: body.threadId, destination: onThreadReady.mock.calls[0]?.[0] })
      return Promise.resolve(
        new Response(response, { headers: { "Content-Type": "text/event-stream" } }),
      )
    }
    return Promise.reject(new Error(`Unexpected request ${url}`))
  })
  const chat = createAstralBeamChat({ fetchAstralBeamToken: token })
  try {
    const sending = chat
      .sendMessage("Start a saved conversation", { onThreadReady, onAccepted })
      .then(settled)
    await vi.waitFor(() => {
      expect(chat.getState().error).toBeUndefined()
      expect(sent).toEqual([{ threadId: threadA, destination: threadA }])
    })
    const accepted = {
      type: "CUSTOM",
      name: "astralbeam_thread",
      value: { threadId: threadA, version: 2, acceptedMessageId: "accepted" },
    }
    stream!.enqueue(
      new TextEncoder().encode(
        [{ type: "RUN_STARTED", threadId: threadA, runId: "initial" }, accepted, accepted]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      ),
    )
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(chat.getState().unsentMessage).toBeUndefined()
    expect(settled).not.toHaveBeenCalled()
    chat.reset()
    stream?.close()
    stream = undefined
    await sending
    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(onThreadReady).toHaveBeenCalledExactlyOnceWith(threadA)
    expect(chat.getState().thread).toBeUndefined()
    expect(chat.getState().unsentMessage).toBeUndefined()
  } finally {
    stream?.close()
    chat.dispose()
  }
})
