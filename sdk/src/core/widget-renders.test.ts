import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { toolResult } from "../lib/define.ts"

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
  agent_id: "saved-agent",
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
  thread.role = "manager"
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
            jsonSchema: { input: () => ({ type: "object" }), output: () => ({ type: "object" }) },
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

test.each(["manager", "viewer"])(
  "%s history only restores authorized widgets and never executes saved business calls",
  async (role) => {
    thread.role = role
    if (role === "viewer") savedMessages = savedWidget("card", "initial")
    const cleanup = vi.fn()
    const onRenderWidget = vi.fn((_request: WidgetRenderRequest) => cleanup)
    const execute = vi.fn()
    const chat = createAstralBeamChat({
      fetchAstralBeamToken: chatAuthToken,
      threadId: thread.id,
      widgets: {
        card: { description: "A host card" },
      },
      tools: {
        change_data: { description: "Change data", execute },
      },
      onRenderWidget,
    })
    try {
      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
      expect(onRenderWidget).not.toHaveBeenCalled()
      savedMessages = savedWidget("card", "refresh")
      savedCursor = "older-page"
      await chat.refreshThread()
      await vi.waitFor(() =>
        expect(onRenderWidget).toHaveBeenCalledTimes(role === "viewer" ? 0 : 1),
      )

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
      await vi.waitFor(() =>
        expect(onRenderWidget).toHaveBeenCalledTimes(role === "viewer" ? 0 : 2),
      )
      expect(onRenderWidget.mock.calls.map(([request]) => request.toolCallId)).toEqual(
        role === "viewer"
          ? []
          : ["saved:assistant-refresh:part-refresh", "saved:assistant-older:part-older"],
      )
      expect(chat.getState().error).toBeUndefined()
      await chat.refreshThread()
      await chat.loadOlderMessages()
      expect(onRenderWidget).toHaveBeenCalledTimes(role === "viewer" ? 0 : 2)
      expect(execute).not.toHaveBeenCalled()
      thread.role = "viewer"
      await chat.refreshThread()
      expect(cleanup).toHaveBeenCalledTimes(role === "viewer" ? 0 : 2)
      expect(onRenderWidget).toHaveBeenCalledTimes(role === "viewer" ? 0 : 2)
    } finally {
      chat.dispose()
    }
  },
)

test.each(["definition", "renderer", "failed-render"])(
  "saved widgets recover when an unavailable %s is supplied in place",
  async (missing) => {
    savedMessages = savedWidget("card", "late")
    const widgets = {
      card: { description: "A host card" },
    }
    const onRenderWidget = vi.fn<(request: WidgetRenderRequest) => void>()
    const chat = createAstralBeamChat({
      fetchAstralBeamToken: chatAuthToken,
      threadId: thread.id,
      widgets: missing === "definition" ? {} : widgets,
      onRenderWidget:
        missing === "renderer"
          ? undefined
          : missing === "failed-render"
            ? () => {
                throw new Error("Host is not ready")
              }
            : onRenderWidget,
    })
    try {
      await vi.waitFor(() => expect(chat.getState().messages).toHaveLength(1))
      chat.updateOptions({ widgets, onRenderWidget })
      await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(1))
      chat.updateOptions({ widgets: { ...widgets } })
      await chat.refreshThread()
      expect(onRenderWidget).toHaveBeenCalledTimes(1)
      expect(onRenderWidget.mock.calls[0]?.[0].toolCallId).toBe("saved:assistant-late:part-late")
    } finally {
      chat.dispose()
    }
  },
)

test.each(["saved", "live"])(
  "%s widget definition changes revalidate before rendering",
  async (mode) => {
    savedMessages = mode === "saved" ? savedWidget("card", "late") : []
    const validation = Promise.withResolvers<{ value: Record<string, unknown> }>()
    const validate = vi.fn(() => validation.promise)
    const onRenderWidget = vi.fn<(request: WidgetRenderRequest) => void>()
    const card = {
      description: "A host card",
      parameters: {
        "~standard": {
          version: 1 as const,
          vendor: "test",
          jsonSchema: { input: () => ({ type: "object" }), output: () => ({ type: "object" }) },
          validate,
        },
      },
    }
    const chat = createAstralBeamChat({
      fetchAstralBeamToken: chatAuthToken,
      threadId: thread.id,
      widgets: { card },
      onRenderWidget,
    })
    try {
      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
      mocked.onCustomEvent?.("astralbeam_thread", {
        threadId: thread.id,
        version: 1,
        saved: true,
        executableToolCallIds: ["call"],
      })
      const execution =
        mode === "live"
          ? mocked.tools
              .find((tool) => tool.name === "show_card")
              ?.execute?.({}, { toolCallId: "call" })
          : undefined
      await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1))
      chat.updateOptions({
        widgets: {
          card: { description: "A card without parameter transforms" },
        },
      })
      validation.resolve({ value: { obsolete: true } })
      await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(1))
      expect(onRenderWidget.mock.calls[0]?.[0].props).toEqual({})
      expect(onRenderWidget.mock.calls[0]?.[0].context.input).toEqual({})
      await execution
    } finally {
      chat.dispose()
    }
  },
)

test("an old async restoration cannot release a newly selected thread's pending render", async () => {
  savedMessages = savedWidget("card", "late")
  const complete: Array<(result: { value: Record<string, unknown> }) => void> = []
  const onRenderWidget = vi.fn<(request: WidgetRenderRequest) => void>()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: {
      card: {
        description: "A host card",
        parameters: {
          "~standard": {
            version: 1,
            vendor: "test",
            jsonSchema: { input: () => ({ type: "object" }), output: () => ({ type: "object" }) },
            validate: () => new Promise((resolve) => complete.push(resolve)),
          },
        },
      },
    },
    onRenderWidget,
  })
  try {
    await vi.waitFor(() => expect(complete).toHaveLength(1))
    await chat.openThread(thread.id)
    expect(complete).toHaveLength(2)
    complete[0]!({ value: {} })
    await Promise.resolve()
    chat.updateOptions({ onRenderWidget: (request) => onRenderWidget(request) })
    await chat.refreshThread()
    expect(complete).toHaveLength(2)
    complete[1]!({ value: {} })
    await vi.waitFor(() => expect(onRenderWidget).toHaveBeenCalledTimes(1))
  } finally {
    chat.dispose()
  }
})

test("later stream snapshots preserve a live widget without rendering it again", async () => {
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
        : [
            {
              type: "MESSAGES_SNAPSHOT",
              messages: [
                {
                  id: "assistant-live",
                  role: "assistant",
                  content: "",
                  toolCalls: [
                    {
                      id: "reused-provider-id",
                      type: "function",
                      function: {
                        name: RENDER_WIDGET_TOOL,
                        arguments: '{"widget":"card","props":{}}',
                      },
                    },
                  ],
                },
                {
                  id: "result-live",
                  role: "tool",
                  toolCallId: "reused-provider-id",
                  content: '{"widget":"card","rendered":true}',
                },
              ],
            },
          ]),
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
    const renderIds: unknown[] = []
    const unsubscribe = chat.subscribe(() => {
      const part = chat.getState().messages.find((message) => message.id === "assistant-live")
        ?.parts[0]
      if (part?.type === "tool-call")
        renderIds.push("widgetRenderId" in part ? part.widgetRenderId : undefined)
    })
    await chat.sendMessage("Continue")
    unsubscribe()
    expect(chat.getState().error).toBeUndefined()
    expect(renderedPartDuringSend).toMatchObject({
      id: "saved:assistant-live:part-live",
      widgetRenderId: "reused-provider-id",
    })
    expect(chat.getState().messages[0]?.parts[0]).toMatchObject({
      widgetRenderId: "reused-provider-id",
    })
    expect(onRenderWidget).toHaveBeenCalledTimes(1)
    expect(renderIds.length).toBeGreaterThan(0)
    expect(new Set(renderIds)).toEqual(new Set(["reused-provider-id"]))
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
  const renderWidget = mocked.tools.find((tool) => tool.name === "show_card")
  for (let call = 0; call < 21; call += 1) {
    await renderWidget?.execute?.({}, { toolCallId: `call-${call}` })
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
  const renderWidget = mocked.tools.find((tool) => tool.name === "show_card")
  await renderWidget?.execute?.({}, { toolCallId: "call-1" })
  await renderWidget?.execute?.({}, { toolCallId: "call-1" })

  releases[0]?.()
  chat.reset()

  expect(cleanupsRun).toEqual(["call-1", "call-1"])

  chat.dispose()
})

test("attached widgets share app controls and dispose a failed update without remounting", async () => {
  const result = {
    content: [{ type: "text", text: "Updated" }],
    structuredContent: { updated: true },
    uiData: { label: "For the widget" },
  }
  const pending = Promise.withResolvers<ReturnType<typeof toolResult>>()
  const action = vi.fn(() => Promise.resolve({ updated: true }))
  const updates = vi.fn<(context: WidgetRenderRequest["context"]) => void>()
  const dispose = vi.fn()
  const render = vi.fn((_request: WidgetRenderRequest) => ({ update: updates, dispose }))
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "Card" } },
    tools: {
      change: { description: "Change", widget: "card", execute: () => pending.promise },
      action: { description: "Widget action", visibility: ["app"], execute: action },
      model_only: { description: "Model action", visibility: ["model"], execute: action },
    },
    onRenderWidget: render,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread).toBeDefined())
    mocked.onCustomEvent?.("astralbeam_thread", {
      threadId: thread.id,
      version: 1,
      saved: true,
      executableToolCallIds: ["attached-call"],
    })
    const execution = mocked.tools.find((tool) => tool.name === "change")!.execute!(
      {},
      { toolCallId: "attached-call" },
    )
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const context = render.mock.calls[0]![0].context
    expect(context).toMatchObject({ invocationId: "attached-call", status: "pending", input: {} })
    await expect(context.callTool("model_only", {})).rejects.toThrow("unavailable")
    await expect(context.callTool("toString")).rejects.toThrow("unavailable")
    await expect(context.callTool("action")).resolves.toEqual({ updated: true })
    expect(action).toHaveBeenCalledTimes(1)
    updates.mockImplementationOnce(() => {
      throw new Error("Update failed")
    })
    pending.resolve(toolResult(result))
    await execution
    expect(updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "complete", result }),
    )
    expect(render).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    chat.reset()
    await expect(context.callTool("action", {})).rejects.toThrow()
    expect(action).toHaveBeenCalledTimes(1)
  } finally {
    chat.dispose()
  }
})

test("saved attached widgets hydrate UI data without replaying their business action", async () => {
  const result = {
    content: [{ type: "text", text: "Found" }],
    structuredContent: { id: "record" },
    uiData: { label: "UI only" },
  }
  const [call, output] = savedWidget("card", "attached")
  savedMessages = [
    {
      ...call,
      parts: [
        {
          ...call!.parts[0],
          name: "lookup",
          input: {},
          arguments: "{}",
          declaration: { resultVersion: 1, widget: "card" },
        },
      ],
    },
    { ...output, parts: [{ ...output!.parts[0], resultVersion: 1, output: result }] },
  ]
  const execute = vi.fn()
  const render = vi.fn<(request: WidgetRenderRequest) => void>()
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "Card" } },
    tools: { lookup: { description: "Lookup", execute } },
    onRenderWidget: render,
  })
  try {
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    expect(render.mock.calls[0]![0].context).toMatchObject({
      input: {},
      result,
      status: "complete",
    })
    expect(execute).not.toHaveBeenCalled()
    await chat.refreshThread()
    expect(render).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  } finally {
    chat.dispose()
  }
})

test("stopping a pending tool cancels its widget and blocks local actions", async () => {
  const pending = Promise.withResolvers<object>()
  const update = vi.fn<(context: WidgetRenderRequest["context"]) => void>()
  const render = vi.fn((_request: WidgetRenderRequest) => ({ update, dispose: vi.fn() }))
  const action = vi.fn(() => ({ updated: true }))
  const chat = createAstralBeamChat({
    fetchAstralBeamToken: chatAuthToken,
    threadId: thread.id,
    widgets: { card: { description: "Card" } },
    tools: {
      change: { description: "Change", widget: "card", execute: () => pending.promise },
      action: { description: "Action", visibility: ["app"], execute: action },
    },
    onRenderWidget: render,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread).toBeDefined())
    mocked.onCustomEvent?.("astralbeam_thread", {
      threadId: thread.id,
      version: 1,
      saved: true,
      executableToolCallIds: ["pending-call"],
    })
    const execution = mocked.tools.find((tool) => tool.name === "change")!.execute!(
      {},
      { toolCallId: "pending-call" },
    )
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    const context = render.mock.calls[0]![0].context
    chat.stop()
    await expect(context.callTool("action")).rejects.toThrow()
    expect(action).not.toHaveBeenCalled()
    pending.resolve({ updated: true })
    await execution
    expect(update.mock.calls.at(-1)![0].status).toBe("cancelled")
    expect(update.mock.calls.at(-1)![0].signal.aborted).toBe(true)
  } finally {
    pending.resolve({ updated: true })
    chat.dispose()
  }
})
