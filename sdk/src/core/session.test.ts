import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { EventType } from "@tanstack/ai/client"

import type { UIMessage } from "@tanstack/ai-client"

import { ASK_QUESTIONNAIRE_TOOL } from "./protocol.ts"
import { createAstralBeamChat } from "./session.ts"

// The token cache only reads `exp` out of the payload; nothing here verifies a signature.
function chatAuthToken(): { token: string } {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 300 }))
  return { token: `header.${payload}.signature` }
}

const currentUser = {
  scope: "tenant",
  organization: { id: "org" },
  tenant: { id: "tenant" },
  user: { id: "user" },
}

const thread = {
  id: "00000000-0000-4000-8000-000000000001",
  title: null,
  agent_id: "saved-agent",
  version: 1,
  role: "manager",
  writer_active: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}
const emptyPage = { items: [], page_after: null, page_before: null }

beforeEach(() => {
  vi.stubGlobal("sessionStorage", undefined)
  // No test should reach the network; the capability handshake fails closed on this.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("the network is unavailable in tests")))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test("HTTP errors reach chat state and callbacks with their API details", async () => {
  const problem = { type: "about:blank", title: "Throttled", status: 429, detail: "Try later" }
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(Response.json(problem, { status: 429 }))),
  )
  const onError = vi.fn()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    streamCallbacks: { onError },
  })
  try {
    await chat.sendMessage("Hello")
    expect(chat.getState().error?.message).toBe(problem.detail)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "AstralBeamApiError",
        message: problem.detail,
        status: 429,
      }),
    )
  } finally {
    chat.dispose()
  }
})

test("reset during a terminal chunk suppresses the old completion callback", async () => {
  let turns = 0
  let created = 0
  vi.stubGlobal("fetch", (input: URL) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.endsWith("/threads"))
      return Promise.resolve(Response.json({ ...thread, id: `conversation-${++created}` }))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...emptyPage,
          thread: { ...thread, id: `conversation-${created}` },
          messages: [],
          pending_interactions: [],
        }),
      )
    if (!path.endsWith("/chat")) return Promise.reject(new Error(`Unexpected request ${path}`))
    const run = { runId: `run-${++turns}`, threadId: `conversation-${created}` }
    const text = { messageId: `reply-${turns}` }
    const events = [
      { type: "RUN_STARTED", ...run },
      { type: "TEXT_MESSAGE_START", ...text, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", ...text, delta: "Reply" },
      { type: "TEXT_MESSAGE_END", ...text },
      { type: "RUN_FINISHED", ...run },
    ]
    return Promise.resolve(
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    )
  })
  const onFinish = vi.fn()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    streamCallbacks: {
      onChunk: (chunk) => {
        if (chunk.type === EventType.RUN_FINISHED && turns === 1) chat.reset()
      },
      onFinish,
    },
  })
  try {
    await chat.sendMessage("First")
    expect(chat.getState().messages).toEqual([])
    expect(onFinish).not.toHaveBeenCalled()
    await chat.sendMessage("Second")
    expect(onFinish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "reply-2" }))
  } finally {
    chat.dispose()
  }
})

// Trimmed from a recorded sandbox turn: the server runs the tool and streams the reply in one body.
test("the reply after a server tool round keeps its first text delta", async () => {
  const run = { runId: "run-1", threadId: thread.id }
  const finished = (finishReason: string) => ({
    type: "RUN_FINISHED",
    ...run,
    metadata: { tanstack: { finishReason } },
  })
  const text = { messageId: "reply" }
  const events = [
    { type: "RUN_STARTED", ...run },
    {
      type: "TOOL_CALL_START",
      toolCallId: "call",
      toolCallName: "write",
      parentMessageId: "call-turn",
    },
    { type: "TOOL_CALL_ARGS", toolCallId: "call", delta: "{}" },
    { type: "TOOL_CALL_END", toolCallId: "call" },
    finished("tool_calls"),
    { type: "TOOL_CALL_RESULT", toolCallId: "call", messageId: "call-turn", content: "{}" },
    { type: "RUN_STARTED", ...run },
    { type: "TEXT_MESSAGE_START", ...text, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", ...text, delta: "I" },
    { type: "TEXT_MESSAGE_CONTENT", ...text, delta: " wrote it." },
    { type: "TEXT_MESSAGE_END", ...text },
    finished("stop"),
  ]
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
  vi.stubGlobal("fetch", (input: URL) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.endsWith("/threads")) return Promise.resolve(Response.json(thread))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({ ...emptyPage, thread, messages: [], pending_interactions: [] }),
      )
    return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }))
  })
  const onFinish = vi.fn<(message: UIMessage) => void>()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    streamCallbacks: { onFinish },
  })
  const statuses: string[] = []
  chat.subscribe(() => statuses.push(chat.getState().status))
  try {
    await chat.sendMessage("Write a file")
    expect(onFinish.mock.calls.at(-1)?.[0].parts.at(-1)).toEqual({
      type: "text",
      content: "I wrote it.",
    })
    // The tool round's intermediate RUN_FINISHED must not make the widget look idle mid-turn.
    expect(
      statuses.slice(statuses.indexOf("streaming"), statuses.lastIndexOf("streaming")),
    ).not.toContain("ready")
  } finally {
    chat.dispose()
  }
})

// A React host rebuilds its tool objects every render, so publishing a fresh `agentTools` for an
// unchanged tool set would notify a subscriber whose rerender feeds the same update back in.
test("rebuilding equivalent tool definitions notifies no subscriber", () => {
  const tools = () => ({
    refresh: {
      description: "Refresh the host's list",
      title: "Refresh the list",
      execute: () => ({ done: true }),
    },
  })
  const chat = createAstralBeamChat({ fetchAstralBeamToken: chatAuthToken, tools: tools() })
  let notifications = 0
  chat.subscribe(() => {
    notifications += 1
  })

  chat.updateOptions({ tools: tools() })
  chat.updateOptions({ tools: tools() })

  expect(notifications).toBe(0)
  expect(chat.getState().agentTools).toEqual([
    { name: ASK_QUESTIONNAIRE_TOOL, title: undefined, widget: undefined },
    { name: "refresh", title: "Refresh the list", widget: undefined },
  ])

  // A real change still reaches the store, so a title update relabels its transcript entry.
  chat.updateOptions({
    tools: {
      refresh: {
        description: "Refresh the host's list",
        execute: () => ({ done: true }),
      },
    },
  })

  expect(notifications).toBe(1)
  expect(chat.getState().agentTools).toEqual([
    { name: ASK_QUESTIONNAIRE_TOOL, title: undefined, widget: undefined },
    { name: "refresh", title: undefined, widget: undefined },
  ])
  chat.dispose()
})

// The handshake runs again per agent and API base, and the responses can land out of order; the
// attachment grant the composer reads must be the current agent's.
test("a capability response for a superseded agent does not overwrite the current grant", async () => {
  const requests: Array<{ url: string; answer: (attachments: boolean) => void }> = []
  vi.stubGlobal("fetch", (input: URL) =>
    String(input).endsWith("/me")
      ? Promise.resolve(Response.json(currentUser))
      : new Promise<Response>((resolve) => {
          requests.push({
            url: String(input),
            answer: (attachments) =>
              resolve(new Response(JSON.stringify({ capabilities: { attachments } }))),
          })
        }),
  )
  const chat = createAstralBeamChat({
    agentId: "agt_acme_first",
    fetchAstralBeamToken: chatAuthToken,
  })
  await vi.waitFor(() => expect(requests).toHaveLength(1))

  chat.updateOptions({ agentId: "agt_acme_second" })
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1]?.url).toContain("agentId=agt_acme_second")

  requests[1]?.answer(false)
  await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(false))
  requests[0]?.answer(true)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(chat.getState().capabilities.attachments).toBe(false)
  chat.dispose()
})

test("a rejected capability request renews once without a refresh notification loop", async () => {
  const fetch = vi.fn((input: string | URL) =>
    Promise.resolve(
      String(input).endsWith("/me")
        ? Response.json(currentUser)
        : new Response(null, { status: 401 }),
    ),
  )
  vi.stubGlobal("fetch", fetch)
  const source = vi.fn(chatAuthToken)
  const chat = createAstralBeamChat({ fetchAstralBeamToken: source })
  try {
    await vi.waitFor(() =>
      expect(
        fetch.mock.calls.filter(([input]) => String(input).includes("/chat/config")),
      ).toHaveLength(2),
    )
    expect(source).toHaveBeenCalledTimes(2)
  } finally {
    chat.dispose()
  }
})
