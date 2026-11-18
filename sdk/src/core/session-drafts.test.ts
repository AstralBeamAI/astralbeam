import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { authenticationIdentity } from "./auth.ts"
import { DEFAULT_API_URL } from "../lib/constants.ts"
import { storedThreadDraft, storedThreadAttachments } from "../lib/drafts.ts"
import { createTestSession, disposeTestSessions } from "./session-fixtures.ts"

const threadA = "00000000-0000-4000-8000-000000000001"
const threadB = "00000000-0000-4000-8000-000000000002"
const currentUser = {
  scope: "tenant",
  organization: { id: "organization" },
  tenant: { id: "tenant" },
  user: { id: "user" },
}
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

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

beforeEach(() => vi.stubGlobal("sessionStorage", undefined))
afterEach(() => {
  disposeTestSessions()
  vi.unstubAllGlobals()
})

function mockUnacknowledgedSend(
  currentAccount: () => typeof currentUser,
  savedAuthor?: () => string | undefined,
) {
  const sent: Array<{
    key: string | null
    body: {
      messages: unknown[]
      tools: unknown[]
      forwardedProps: { clientId: string; clientMessageId: string }
    }
  }> = []
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentAccount()))
    if (url.pathname.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (url.pathname.endsWith("/messages")) {
      const id = url.pathname.split("/").at(-2)!
      const author = savedAuthor?.()
      return Promise.resolve(
        Response.json({
          ...page(id),
          messages:
            id === threadA && (sent.length > 1 || (author && sent.length > 0))
              ? [
                  {
                    id: "accepted",
                    role: "user",
                    author_tenant_user_id: author,
                    client_message_id: author && sent[0]?.body.forwardedProps.clientMessageId,
                    created_at: thread(id).created_at,
                    parts: [{ id: "part", type: "text", content: "Keep my original intent" }],
                  },
                ]
              : [],
        }),
      )
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
      if (sent.length === 1) return Promise.reject(new TypeError("Connection lost after admission"))
      return Promise.resolve(Response.json({ accepted_message_id: "accepted", thread_version: 2 }))
    }
    return Promise.reject(new Error(`Unexpected request ${url}`))
  })
  return sent
}

async function openFirstThread() {
  const chat = createTestSession({ threadId: threadA })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
  return chat
}

test.each(["selection", "api", "identity"] as const)(
  "%s changes preserve uncertain submissions only within the same authenticated scope",
  async (change) => {
    let user = currentUser
    const sent = mockUnacknowledgedSend(() => user)
    const onAccepted = vi.fn()
    const chat = createTestSession({ threadId: threadA })
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
    const content = "Keep my original intent"
    await chat.sendMessage(content, { onAccepted })
    await chat.openThread(threadB)
    expect(chat.getState().submission).toBeUndefined()

    const retained = change === "selection"
    if (change === "api") chat.updateOptions({ apiUrl: "https://replacement.example/api" })
    else if (change === "identity") {
      user = { ...currentUser, user: { id: "another-user" } }
      chat.retryAuthentication()
    } else await chat.openThread(threadA)

    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
    expect(chat.getState().submission?.content).toBe(retained ? content : undefined)
    if (retained) await chat.retry()
    else await chat.sendMessage(content)
    expect(sent).toHaveLength(2)
    expect(sent[0]?.key).toBeTruthy()
    expect(sent[1]?.key === sent[0]?.key).toBe(retained)
    expect(chat.getState().submission?.phase).toBe("accepted")
    expect(onAccepted).toHaveBeenCalledTimes(retained ? 1 : 0)
  },
)

test.each([false, true])(
  "reload recovery respects the replay window (expired=%s)",
  async (expired) => {
    vi.stubGlobal("sessionStorage", memoryStorage())
    let user = currentUser
    const sent = mockUnacknowledgedSend(() => user)
    const content = { id: "original", content: "Keep my original intent" }
    const original = createTestSession({
      threadId: threadA,
      tools: { summarize: { description: "Summarize text", execute: () => null } },
    })
    await vi.waitFor(() => expect(original.getState().thread?.id).toBe(threadA))
    const submitted = await original.sendMessage(content)
    expect(sent[0]?.body.forwardedProps.clientMessageId).toBe(submitted.id)
    original.dispose()

    user = { ...currentUser, user: { id: "another-user" } }
    const other = await openFirstThread()
    expect(other.getState().submission).toBeUndefined()
    other.dispose()
    user = currentUser

    const reopened = await openFirstThread()
    expect(reopened.getState().submission).toMatchObject({ phase: "failed", content })
    await reopened.reload()
    expect(sent).toHaveLength(1)
    const clock = expired
      ? vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60 * 1000)
      : undefined
    const retry = await reopened.retry().finally(() => clock?.mockRestore())
    expect(retry).toMatchObject(
      expired ? { phase: "failed", retryExpired: true } : { phase: "accepted" },
    )
    expect(sent[0]?.key).toBeTruthy()
    expect(sent.slice(1)).toMatchObject(
      expired
        ? []
        : [
            {
              key: sent[0]!.key,
              body: {
                messages: [{ ...content, role: "user" }],
                tools: sent[0]!.body.tools,
                forwardedProps: sent[0]!.body.forwardedProps,
              },
            },
          ],
    )
    expect(reopened.getState().messages.map(({ id }) => id)).toEqual(expired ? [] : ["accepted"])
    reopened.dispose()
    expect((await openFirstThread()).getState().submission?.phase).toBe(
      expired ? "failed" : undefined,
    )
  },
)

test("saved history confirms an unacknowledged send only for its author", async () => {
  vi.stubGlobal("sessionStorage", memoryStorage())
  let author: string | undefined
  const sent = mockUnacknowledgedSend(
    () => currentUser,
    () => author,
  )
  const original = await openFirstThread()
  expect((await original.sendMessage("Keep my original intent")).phase).toBe("failed")
  original.dispose()

  author = "another-user"
  const reopened = await openFirstThread()
  expect(reopened.getState().submission?.phase).toBe("failed")

  author = currentUser.user.id
  await reopened.refreshThread()
  expect(reopened.getState().submission?.phase).toBe("accepted")
  expect(reopened.getState().messages.map(({ id }) => id)).toEqual(["accepted"])
  expect(sent).toHaveLength(1)
  reopened.dispose()
  expect((await openFirstThread()).getState().submission).toBeUndefined()
})

test("a whitespace-only text send never dispatches", async () => {
  const sent = mockUnacknowledgedSend(() => currentUser)
  const chat = await openFirstThread()
  expect((await chat.sendMessage(" \n ")).phase).toBe("refused")
  expect(sent).toHaveLength(0)
})

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
  const chat = createTestSession({
    threadId: threadA,
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
  const send = chat.sendMessage("Only for conversation A", { onThreadReady, onAccepted })
  chat.reset()
  await send
  expect(mutations).toEqual([])
  expect(chat.getState().thread).toBeUndefined()
  expect(chat.getState().submission).toBeUndefined()
  expect(chat.getState().error).toBeUndefined()
  expect(onThreadReady).not.toHaveBeenCalled()
  expect(onAccepted).not.toHaveBeenCalled()
})

test("new-conversation callbacks acknowledge input while refresh preserves the reply", async () => {
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
  let historyReads = 0
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
    if (url.pathname.endsWith("/messages")) {
      historyReads++
      return Promise.resolve(Response.json(page(threadA)))
    }
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
  const chat = createTestSession()
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
        [
          { type: "RUN_STARTED", threadId: threadA, runId: "initial" },
          accepted,
          {
            ...accepted,
            value: {
              ...accepted.value,
              acceptedMessage: {
                id: "older-user",
                role: "user",
                created_at: thread(threadA).created_at,
                parts: [{ id: "older-part", type: "text", content: "An older input" }],
              },
            },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      ),
    )
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    expect(chat.getState().submission?.phase).toBe("accepted")
    expect(chat.getState().messages.findLast((message) => message.role === "user")?.parts).toEqual([
      { type: "text", content: "Start a saved conversation" },
    ])
    const readsBeforeRefresh = historyReads
    await chat.refreshThread()
    await chat.reload()
    expect(historyReads).toBe(readsBeforeRefresh)
    expect(settled).not.toHaveBeenCalled()
    chat.reset()
    stream?.close()
    stream = undefined
    await sending
    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(onThreadReady).toHaveBeenCalledExactlyOnceWith(threadA)
    expect(chat.getState().thread).toBeUndefined()
    expect(chat.getState().submission).toBeUndefined()
  } finally {
    stream?.close()
  }
})

test("an upload keeps its picked agent while its file is read across conversation changes", async () => {
  const upload = vi.fn()
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/messages")) {
      const id = path.split("/").at(-2)!
      return Promise.resolve(
        Response.json({ ...page(id), thread: { ...thread(id), agent_id: id } }),
      )
    }
    if (path.endsWith("/files")) {
      new Request(input, init)
      if (typeof init?.body !== "string") throw new Error("Expected an upload body")
      upload(JSON.parse(init.body))
      return Promise.resolve(Response.json({ fileId: "file", mimeType: "text/plain", byteSize: 4 }))
    }
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createTestSession({ threadId: threadA })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(threadA))
  let finish!: (data: string) => void
  const data = new Promise<string>((resolve) => {
    finish = resolve
  })
  const uploading = chat.uploadAttachment({ data, filename: "note.txt", mimeType: "text/plain" })
  await chat.openThread(threadB)
  finish(btoa("note"))
  await uploading
  expect(upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: threadA }))
})

test("reset without a view clears only this placement's new draft", async () => {
  vi.stubGlobal("localStorage", memoryStorage())
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(currentUser)))
  const chat = createTestSession({ placementKey: "setup", threadId: "new" })
  await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
  const auth = chat.getState().auth
  if (auth.status !== "ready") throw new Error("Expected a verified account")
  const account = authenticationIdentity(auth.currentUser)
  const identity = JSON.stringify([account, "setup"])
  const other = JSON.stringify([account, "sidebar"])
  storedThreadDraft(DEFAULT_API_URL, identity, "", "Unsent setup")
  storedThreadDraft(DEFAULT_API_URL, identity, "", "Unconfirmed setup", "sent")
  storedThreadDraft(DEFAULT_API_URL, identity, threadA, "Saved conversation draft")
  storedThreadDraft(DEFAULT_API_URL, other, "", "Sidebar draft")
  await storedThreadAttachments({
    apiUrl: DEFAULT_API_URL,
    identity,
    threadId: "",
    update: () => [
      {
        id: "file",
        fileId: "uploaded",
        name: "note.txt",
        mimeType: "text/plain",
        size: 1,
        status: "ready",
      },
    ],
  })
  chat.reset()
  expect(storedThreadDraft(DEFAULT_API_URL, identity, "")).toBe("")
  expect(storedThreadDraft(DEFAULT_API_URL, identity, "", undefined, "sent")).toBe("")
  expect(storedThreadDraft(DEFAULT_API_URL, identity, threadA)).toBe("Saved conversation draft")
  expect(storedThreadDraft(DEFAULT_API_URL, other, "")).toBe("Sidebar draft")
  expect(
    await storedThreadAttachments({ apiUrl: DEFAULT_API_URL, identity, threadId: "" }),
  ).toEqual([])
})
