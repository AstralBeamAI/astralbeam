import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { RENDER_WIDGET_TOOL } from "./protocol.ts"
import { createAstralBeamChat, type WidgetRenderRequest } from "./session.ts"

interface ClientTool {
  name: string
  execute?: (input: unknown, context: { toolCallId: string }) => Promise<unknown>
}

const mocked = vi.hoisted(() => ({
  tools: [] as readonly ClientTool[],
  onCustomEvent: undefined as ((name: string, data: unknown) => void) | undefined,
}))

// Capture the declared render callback while retaining the real client's stream and history behavior.
vi.mock("@tanstack/ai-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/ai-client")>()
  return {
    ...actual,
    ChatClient: class extends actual.ChatClient {
      constructor(options: ConstructorParameters<typeof actual.ChatClient>[0]) {
        super(options)
        mocked.tools = (options.tools ?? []) as readonly ClientTool[]
        mocked.onCustomEvent = (name, data) => options.onCustomEvent?.(name, data, {})
      }
    },
  }
})

function chatAuthToken(): { token: string } {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 300 }))
  return { token: `header.${payload}.signature` }
}

const thread = {
  id: "conversation",
  title: null,
  agent_id: null,
  version: 1,
  role: "manager",
  writer_active: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}
let savedMessages: unknown[] = []
let olderMessages: unknown[] = []
let savedCursor: string | null = null
beforeEach(() => {
  savedMessages = []
  olderMessages = []
  savedCursor = null
  vi.stubGlobal("fetch", (input: URL) => {
    const path = String(input)
    if (path.endsWith("/me"))
      return Promise.resolve(
        Response.json({
          scope: "tenant",
          organization: { id: "organization" },
          tenant: { id: "tenant" },
          user: { id: "user" },
        }),
      )
    if (path.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.includes("/threads?"))
      return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
    const older = new URL(input).searchParams.has("page_after")
    return Promise.resolve(
      Response.json({
        thread,
        messages: older ? olderMessages : savedMessages,
        pending_interactions: [],
        page_after: older ? null : savedCursor,
        page_before: null,
      }),
    )
  })
})
afterEach(() => vi.unstubAllGlobals())

function savedWidget(widget: string, id: string) {
  return [
    {
      id: `assistant-${id}`,
      role: "assistant",
      created_at: thread.created_at,
      parts: [
        {
          id: `part-${id}`,
          type: "tool-call",
          toolCallId: "reused-provider-id",
          name: RENDER_WIDGET_TOOL,
          arguments: JSON.stringify({ widget, props: {} }),
          input: { widget, props: {} },
          state: "input-complete",
        },
      ],
    },
    {
      id: `result-${id}`,
      role: "tool",
      source_assistant_message_id: `assistant-${id}`,
      source_tool_part_id: `part-${id}`,
      created_at: thread.created_at,
      parts: [
        {
          type: "tool-result",
          toolCallId: "reused-provider-id",
          outcome: "succeeded",
          output: { widget, rendered: true },
        },
      ],
    },
  ]
}

test("hydration restores distinct widget calls and skips missing or incompatible definitions", async () => {
  savedMessages = ["card", "card", "incompatible", "removed"].flatMap((widget, index) =>
    savedWidget(widget, String(index)),
  )
  const onRenderWidget = vi.fn<(request: WidgetRenderRequest) => void>()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: {
      card: { description: "A host card" },
      incompatible: {
        description: "A card whose parameters have changed",
        parameters: {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: () => ({ issues: [{ message: "Required field missing" }] }),
          },
        },
      },
    },
    onRenderWidget,
  })
  try {
    await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(2))
    expect(onRenderWidget.mock.calls.map(([request]) => request.toolCallId)).toEqual([
      "saved:assistant-0:part-0",
      "saved:assistant-1:part-1",
    ])
    await chat.refreshThread()
    expect(onRenderWidget).toHaveBeenCalledTimes(2)
  } finally {
    chat.dispose()
  }
})

test("refresh and older history restore new widgets once without executing saved business calls", async () => {
  const onRenderWidget = vi.fn<(request: WidgetRenderRequest) => void>()
  const execute = vi.fn()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "A host card" } },
    tools: { change_data: { description: "Change data", execute } },
    onRenderWidget,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    expect(onRenderWidget).not.toHaveBeenCalled()
    savedMessages = savedWidget("card", "refresh")
    savedCursor = "older-page"
    await chat.refreshThread()
    await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(1))

    olderMessages = [
      ...savedWidget("card", "older"),
      {
        id: "saved-business-call",
        role: "assistant",
        created_at: thread.created_at,
        parts: [
          {
            id: "business-part",
            type: "tool-call",
            toolCallId: "reused-provider-id",
            name: "change_data",
            arguments: "{}",
            input: {},
            state: "input-complete",
          },
        ],
      },
    ]
    await chat.loadOlderMessages()
    await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(2))
    expect(onRenderWidget.mock.calls.map(([request]) => request.toolCallId)).toEqual([
      "saved:assistant-refresh:part-refresh",
      "saved:assistant-older:part-older",
    ])
    expect(chat.getState().error).toBeUndefined()
    await chat.refreshThread()
    await chat.loadOlderMessages()
    expect(onRenderWidget).toHaveBeenCalledTimes(2)
    expect(execute).not.toHaveBeenCalled()
  } finally {
    chat.dispose()
  }
})

test("the next send preserves a live widget's render identity without rendering it again", async () => {
  const fetchHistory = fetch
  let sends = 0
  let renderedPartDuringSend: unknown
  const onRenderWidget = vi.fn<(request: WidgetRenderRequest) => void>()
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input instanceof Request ? input.url : String(input)
    if (!path.endsWith("/chat")) return fetchHistory(input, init)
    sends++
    const first = sends === 1
    if (!first) renderedPartDuringSend = chat.getState().messages[0]?.parts[0]
    savedMessages = savedWidget("card", "live")
    const run = { threadId: thread.id, runId: `run-${sends}` }
    const chunks = [
      { type: "RUN_STARTED", ...run },
      {
        type: "CUSTOM",
        name: "astralbeam_thread",
        value: {
          threadId: thread.id,
          version: sends + 1,
          saved: true,
          acceptedMessageId: `user-${sends}`,
        },
      },
      ...(first
        ? [
            {
              type: "TOOL_CALL_START",
              parentMessageId: "assistant-live",
              toolCallId: "reused-provider-id",
              toolCallName: RENDER_WIDGET_TOOL,
            },
            {
              type: "TOOL_CALL_ARGS",
              toolCallId: "reused-provider-id",
              delta: '{"widget":"card","props":{}}',
            },
            { type: "TOOL_CALL_END", toolCallId: "reused-provider-id" },
            {
              type: "TOOL_CALL_RESULT",
              toolCallId: "reused-provider-id",
              messageId: "assistant-live",
              content: '{"widget":"card","rendered":true}',
            },
          ]
        : []),
      { type: "RUN_FINISHED", ...run, metadata: { tanstack: { finishReason: "stop" } } },
    ]
    return Promise.resolve(
      new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    )
  })
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "A host card" } },
    onRenderWidget,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    await chat.sendMessage("Show the card")
    expect(sends).toBe(1)
    expect(chat.getState().error).toBeUndefined()
    await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(1))
    expect(onRenderWidget.mock.calls[0]?.[0].toolCallId).toBe("reused-provider-id")
    await chat.sendMessage("Continue")
    expect(chat.getState().error).toBeUndefined()
    expect(renderedPartDuringSend).toMatchObject({
      id: "saved:assistant-live:part-live",
      widgetRenderId: "reused-provider-id",
    })
    expect(chat.getState().messages[0]?.parts[0]).toMatchObject({
      widgetRenderId: "reused-provider-id",
    })
    expect(onRenderWidget).toHaveBeenCalledTimes(1)
  } finally {
    chat.dispose()
  }
})

// The chat widget caps its live renders and disposes the oldest itself. The session keeps a cleanup
// per tool call, which captures that render, so an evicted one has to leave nothing behind.
test("a released render leaves no cleanup behind in the session", async () => {
  const cleanupsRun: string[] = []
  const releases = new Map<string, () => void>()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "A host card" } },
    onRenderWidget: ({ toolCallId, release }) => {
      releases.set(toolCallId, release)
      return () => cleanupsRun.push(toolCallId)
    },
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  mocked.onCustomEvent?.("astralbeam_thread", {
    threadId: thread.id,
    version: 1,
    saved: true,
    executableToolCallIds: Array.from({ length: 21 }, (_, index) => `call-${index}`),
  })
  const renderWidget = mocked.tools.find((tool) => tool.name === RENDER_WIDGET_TOOL)
  for (let call = 0; call < 21; call += 1) {
    await renderWidget?.execute?.({ widget: "card", props: {} }, { toolCallId: `call-${call}` })
  }

  // What eviction past the render cap does: the host disposed its own DOM and forgets the cleanup.
  releases.get("call-0")?.()
  chat.reset()

  expect(cleanupsRun).toHaveLength(20)
  expect(cleanupsRun).not.toContain("call-0")

  chat.dispose()
})

// A repeat of the same call replaces its own render, and the replacement's cleanup must survive a
// release arriving late from the render it superseded.
test("a late release keeps the cleanup of the render that took over the tool call", async () => {
  const cleanupsRun: string[] = []
  const releases: Array<() => void> = []
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "A host card" } },
    onRenderWidget: ({ toolCallId, release }) => {
      releases.push(release)
      return () => cleanupsRun.push(toolCallId)
    },
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  mocked.onCustomEvent?.("astralbeam_thread", {
    threadId: thread.id,
    version: 1,
    saved: true,
    executableToolCallIds: Array.from({ length: 21 }, (_, index) => `call-${index}`),
  })
  const renderWidget = mocked.tools.find((tool) => tool.name === RENDER_WIDGET_TOOL)
  await renderWidget?.execute?.({ widget: "card", props: {} }, { toolCallId: "call-1" })
  await renderWidget?.execute?.({ widget: "card", props: {} }, { toolCallId: "call-1" })

  releases[0]?.()
  chat.reset()

  expect(cleanupsRun).toEqual(["call-1", "call-1"])

  chat.dispose()
})
