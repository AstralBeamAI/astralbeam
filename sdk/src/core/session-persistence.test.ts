import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createAstralBeamChat } from "./session.ts"

const thread = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Saved conversation",
  agent_id: "saved-agent",
  version: 1,
  role: "manager",
  writer_active: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}
const currentUser = {
  scope: "tenant",
  organization: { id: "organization" },
  tenant: { id: "tenant" },
  user: { id: "user" },
}
const token = () => ({
  token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
})
const page = (messages: unknown[] = []) => ({
  thread,
  messages,
  pending_interactions: [],
  page_after: null,
  page_before: null,
})

beforeEach(() => vi.stubGlobal("sessionStorage", undefined))
afterEach(() => vi.unstubAllGlobals())

test.each([
  { threadId: undefined, cached: thread.id, expected: thread.id },
  { threadId: "new", cached: thread.id, expected: undefined },
  {
    threadId: "00000000-0000-4000-8000-000000000002",
    cached: thread.id,
    expected: "00000000-0000-4000-8000-000000000002",
  },
])(
  "thread selection $threadId with cached $cached honors its mode without reading shared local storage",
  async ({ threadId, cached, expected }) => {
    let stored: string | null = cached
    const readLocal = vi.fn(() => "unrelated-thread")
    vi.stubGlobal("localStorage", { getItem: readLocal })
    vi.stubGlobal("sessionStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value
      },
      removeItem: () => {
        stored = null
      },
    })
    const loads: string[] = []
    vi.stubGlobal("fetch", (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
      if (url.pathname.endsWith("/messages")) {
        const id = url.pathname.split("/").at(-2)!
        loads.push(id)
        return Promise.resolve(Response.json({ ...page(), thread: { ...thread, id } }))
      }
      if (url.pathname.endsWith("/threads"))
        return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    })
    const chat = createAstralBeamChat({ threadId, fetchAstralBeamToken: token })
    try {
      await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(expected))
      expect(loads).toEqual(expected ? [expected] : [])
      chat.updateOptions({ threadId: "new" })
      expect(chat.getState().thread).toBeUndefined()
      expect(readLocal).not.toHaveBeenCalled()
    } finally {
      chat.dispose()
    }
  },
)

test("creates on first send, hides failed empty threads, and lists accepted titles", async () => {
  let created = 0
  let submissions = 0
  let accepted = false
  const empty = { ...thread, title: "", version: 0 }
  const saved = { ...thread, title: "First message" }
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.endsWith("/threads") && init?.method === "POST") {
      created++
      return Promise.resolve(Response.json(empty))
    }
    if (path.includes("/threads?"))
      return Promise.resolve(
        Response.json({ items: accepted ? [saved] : [], page_after: null, page_before: null }),
      )
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...page(
            accepted
              ? [
                  {
                    id: "accepted",
                    role: "user",
                    created_at: thread.created_at,
                    parts: [{ id: "part", type: "text", content: "First message" }],
                  },
                ]
              : [],
          ),
          thread: accepted ? saved : empty,
        }),
      )
    if (path.endsWith("/chat")) {
      submissions++
      if (submissions === 1) return Promise.resolve(new Response("Rejected input", { status: 400 }))
      accepted = true
      return Promise.resolve(
        Response.json({
          thread_id: saved.id,
          accepted_message_id: "accepted",
          thread_version: 1,
        }),
      )
    }
    return Promise.reject(new Error(`Unexpected request ${path}`))
  })
  const chat = createAstralBeamChat({ fetchAstralBeamToken: token })
  try {
    await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
    expect(chat.getState().status).toBe("ready")
    expect(chat.getState().error).toBeUndefined()
    chat.reset()
    expect(created).toBe(0)
    await chat.sendMessage("First message")
    expect(created).toBe(1)
    expect(chat.getState().thread?.hasMessages).toBe(false)
    expect((await chat.searchThreads()).items).toEqual([])
    expect(chat.getState().messages).toEqual([])
    expect(chat.getState().unsentMessage).toBe("First message")
    expect(chat.getState().status).toBe("error")
    await chat.sendMessage("First message")
    expect((await chat.searchThreads()).items[0]?.title).toBe("First message")
    expect(created).toBe(1)
    expect(chat.getState().thread?.hasMessages).toBe(true)
  } finally {
    chat.dispose()
  }
})

test.each(["unchanged", "viewer", "deleted"] as const)("uncertain replay: %s", async (mode) => {
  let changed = false
  const downgraded = mode !== "unchanged"
  const unavailable =
    "This conversation’s agent is unavailable. Start a new conversation to continue."
  const denied =
    mode === "deleted" ? unavailable : "You have read-only access to this conversation."
  const sent: Array<{
    key: string | null
    body: { messages: unknown[]; tools: unknown[]; forwardedProps: Record<string, unknown> }
  }> = []
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    new Request(input, init)
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...page(),
          thread: {
            ...thread,
            writer_active: true,
            role: changed && mode === "viewer" ? "viewer" : "manager",
            agent_id: changed && mode === "deleted" ? null : thread.agent_id,
          },
        }),
      )
    if (path.endsWith("/chat")) {
      if (typeof init?.body !== "string") throw new Error("Expected an AG-UI request body")
      sent.push({
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: JSON.parse(init.body) as (typeof sent)[number]["body"],
      })
      if (sent.length === 1) return Promise.reject(new TypeError("Connection lost after admission"))
      if (sent.length === 2)
        return Promise.resolve(
          Response.json({
            thread_id: thread.id,
            accepted_message_id: "accepted",
            thread_version: 2,
          }),
        )
      return Promise.resolve(
        new Response(
          [
            { type: "RUN_STARTED", threadId: thread.id, runId: "run" },
            {
              type: "CUSTOM",
              name: "astralbeam_thread",
              value: { threadId: thread.id, version: 2, acceptedMessageId: "accepted" },
            },
            { type: "RUN_FINISHED", threadId: thread.id, runId: "run" },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      )
    }
    return Promise.reject(new Error(`Unexpected request ${path}`))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  const onAccepted = vi.fn()
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    await chat.sendMessage("Hello", { onAccepted })
    expect(chat.getState().unsentMessage).toBe("Hello")
    changed = true
    await chat.reload()
    expect(sent).toHaveLength(1)
    expect(chat.getState().unsentMessage).toBe("Hello")
    await chat.sendMessage("Edited uncertain input")
    expect(sent).toHaveLength(1)
    expect(chat.getState().unsentMessage).toBe("Hello")
    expect(chat.getState().error?.message).toContain(
      downgraded ? denied : "acceptance is unconfirmed",
    )
    chat.updateOptions({
      tools: { changed: { description: "Changed declaration", execute: () => ({}) } },
    })
    await chat.sendMessage("Hello")
    expect(sent).toHaveLength(2)
    expect(sent[0]?.key).toBeTruthy()
    expect(sent[1]?.key).toBe(sent[0]?.key)
    expect(sent[1]?.body.messages).toHaveLength(1)
    expect(sent[1]?.body.tools).toEqual(sent[0]?.body.tools)
    expect(chat.getState().unsentMessage).toBeUndefined()
    expect(chat.getState().error).toBeUndefined()
    expect(onAccepted).toHaveBeenCalledOnce()
    await chat.sendMessage("Another intent")
    expect(sent).toHaveLength(downgraded ? 2 : 3)
    expect(sent.at(-1)?.key === sent[0]?.key).toBe(downgraded)
    expect(JSON.stringify(sent.at(-1)?.body.tools) === JSON.stringify(sent[0]?.body.tools)).toBe(
      downgraded,
    )
    expect(chat.getState().error?.message).toBe(downgraded ? denied : undefined)
  } finally {
    chat.dispose()
  }
})

test.each([
  { status: 400, uncertain: false },
  { status: 413, uncertain: false },
  { status: 429, uncertain: false },
  { status: 400, uncertain: true },
  { status: 413, uncertain: true },
  { status: 429, uncertain: true },
])(
  "a rejection $status permits editing only without earlier uncertainty=$uncertain",
  async ({ status, uncertain }) => {
    const keys: Array<string | null> = []
    const bodies: {
      tools: { name: string }[]
      forwardedProps: { toolMetadata: Record<string, unknown> }
    }[] = []
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname
      if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
      if (path.endsWith("/config"))
        return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
      if (path.endsWith("/messages")) return Promise.resolve(Response.json(page()))
      if (path.endsWith("/threads"))
        return Promise.resolve(Response.json({ items: [thread], page_after: null }))
      keys.push(new Headers(init?.headers).get("Idempotency-Key"))
      bodies.push(JSON.parse(init!.body as string) as (typeof bodies)[number])
      if (uncertain && keys.length === 1)
        return Promise.reject(new TypeError("Acknowledgment lost"))
      return Promise.resolve(
        Response.json(
          {
            type: "about:blank",
            title: "Rejected",
            status,
            detail: "Input was not admitted.",
          },
          { status },
        ),
      )
    })
    const chat = createAstralBeamChat({
      threadId: thread.id,
      fetchAstralBeamToken: token,
      tools: { old_tool: { description: "Old", execute: () => ({}) } },
    })
    try {
      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
      await chat.sendMessage("Original input")
      if (uncertain) await chat.sendMessage("Original input")
      chat.updateOptions({
        tools: { new_tool: { description: "New", execute: () => ({}) } },
      })
      await chat.sendMessage("Corrected input")
      expect(keys).toHaveLength(2)
      expect(keys[1] === keys[0]).toBe(uncertain)
      const name = uncertain ? "old_tool" : "new_tool"
      expect(bodies[1]!.tools.map((tool) => tool.name)).toContain(name)
      expect(bodies[1]!.forwardedProps.toolMetadata).toHaveProperty(name)
      expect(bodies[1]!.forwardedProps.toolMetadata).not.toHaveProperty(
        uncertain ? "new_tool" : "old_tool",
      )
      expect(chat.getState().unsentMessage).toBe(uncertain ? "Original input" : "Corrected input")
      expect(chat.getState().error?.message).toContain(
        uncertain ? "acceptance is unconfirmed" : "Input was not admitted",
      )
    } finally {
      chat.dispose()
    }
  },
)

test("reset before authentication resolves does not restore the previous conversation", async () => {
  let resolveIdentity: ((response: Response) => void) | undefined
  const historyReads: string[] = []
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = String(input)
    if (path.endsWith("/me"))
      return new Promise<Response>((resolve) => {
        resolveIdentity = resolve
      })
    if (path.endsWith("/chat/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    historyReads.push(path)
    return Promise.resolve(Response.json(page()))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(resolveIdentity).toBeDefined())
    chat.reset()
    resolveIdentity!(Response.json(currentUser))
    await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
    expect(chat.getState().thread).toBeUndefined()
    expect(historyReads).toEqual([])
  } finally {
    chat.dispose()
  }
})

test("opening saved tool calls restores their results without executing host tools", async () => {
  const execute = vi.fn()
  const messages = [
    {
      id: "assistant",
      role: "assistant",
      created_at: thread.created_at,
      parts: [
        {
          id: "application-part",
          type: "tool-call",
          toolCallId: "provider-call",
          name: "change_data",
          arguments: "{}",
          input: {},
          state: "input-complete",
        },
      ],
    },
    {
      id: "tool",
      role: "tool",
      source_assistant_message_id: "assistant",
      source_tool_part_id: "application-part",
      created_at: thread.created_at,
      parts: [
        {
          id: "result-part",
          type: "tool-result",
          toolCallId: "provider-call",
          outcome: "succeeded",
          output: { done: true },
        },
      ],
    },
  ]
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?")) return Promise.resolve(Response.json(page(messages)))
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
    tools: { change_data: { description: "Change data", widget: "card", execute } },
    widgets: { card: { description: "Card" } },
  })
  try {
    await vi.waitFor(() => expect(chat.getState().messages).toHaveLength(1))
    expect(chat.getState().messages[0]?.parts[0]).toMatchObject({
      id: "saved:assistant:application-part",
      upstreamToolCallId: "provider-call",
      applicationPartId: "application-part",
      state: "complete",
      output: { done: true },
      widget: undefined,
    })
    expect(execute).not.toHaveBeenCalled()
  } finally {
    chat.dispose()
  }
})

test("changing API scope drops saved history before the replacement account resolves", async () => {
  const setItem = vi.fn()
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem })
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = String(input)
    if (path.startsWith("https://replacement.example")) return new Promise<Response>(() => {})
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json(
          page([
            {
              id: "private",
              role: "user",
              created_at: thread.created_at,
              parts: [{ type: "text", content: "Private history" }],
            },
          ]),
        ),
      )
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().messages).toHaveLength(1))
    expect(setItem).toHaveBeenCalledWith(
      expect.stringContaining('["tenant","organization","tenant","user",null]'),
      thread.id,
    )
    chat.updateOptions({ apiUrl: "https://replacement.example/api" })
    expect(chat.getState().messages).toEqual([])
    expect(chat.getState().thread).toBeUndefined()
  } finally {
    chat.dispose()
  }
})

test("an explicit unknown outcome continues while another response is active without executing the action", async () => {
  const execute = vi.fn()
  let posted:
    | { results: Array<{ outcome: string; source_part_id: string; response_target_id: string }> }
    | undefined
  const pending = {
    source_message_id: "assistant",
    source_part_id: "application-part",
    response_target_id: "target",
    tool_call_id: "provider-call",
    target_tenant_user_id: "user",
    target_client_id: "previous-client",
    execution_location: "browser",
  }
  const assistant = {
    id: "assistant",
    role: "assistant",
    created_at: thread.created_at,
    parts: [
      {
        id: "application-part",
        type: "tool-call",
        toolCallId: "provider-call",
        name: "change_data",
        arguments: "{}",
        input: {},
        state: "input-complete",
      },
    ],
  }
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...page([assistant]),
          thread: { ...thread, writer_active: true },
          pending_interactions: posted ? [] : [pending],
        }),
      )
    if (path.endsWith("/tool-results")) {
      if (typeof init?.body !== "string") throw new Error("Expected a tool result body")
      posted = JSON.parse(init.body) as NonNullable<typeof posted>
      return Promise.resolve(
        Response.json({
          thread_id: thread.id,
          accepted_message_id: "resolution",
          thread_version: 2,
        }),
      )
    }
    if (path.endsWith("/chat")) throw new Error("A tool result must not resubmit a user message")
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
    tools: { change_data: { description: "Change data", execute } },
  })
  try {
    await vi.waitFor(() => expect(chat.getState().pendingInteractions).toHaveLength(1))
    await chat.abandonToolCall("saved:assistant:application-part:target")
    await vi.waitFor(() =>
      expect(posted?.results).toEqual([
        {
          source_message_id: "assistant",
          source_part_id: "application-part",
          response_target_id: "target",
          outcome: "unknown",
          output: null,
        },
      ]),
    )
    expect(execute).not.toHaveBeenCalled()
    expect(posted).not.toHaveProperty("expected_version")
  } finally {
    chat.dispose()
  }
})

test.each([
  {
    grant: true,
    saved: true,
    expectedExecutions: 1,
    failOnce: false,
    throwsAfterCommit: false,
    delayed: "navigation",
  },
  {
    grant: true,
    saved: true,
    expectedExecutions: 1,
    failOnce: false,
    throwsAfterCommit: false,
    delayed: "reopen",
  },
  {
    grant: true,
    saved: true,
    expectedExecutions: 1,
    failOnce: false,
    throwsAfterCommit: false,
    delayed: "api",
  },
  {
    grant: true,
    saved: true,
    expectedExecutions: 1,
    failOnce: false,
    throwsAfterCommit: false,
    delayed: "identity",
  },
  {
    grant: true,
    saved: true,
    expectedExecutions: 0,
    failOnce: false,
    throwsAfterCommit: false,
    questionnaire: true,
  },
  { grant: true, saved: true, expectedExecutions: 1, failOnce: false, throwsAfterCommit: false },
  { grant: false, saved: true, expectedExecutions: 0, failOnce: false, throwsAfterCommit: false },
  { grant: true, saved: false, expectedExecutions: 0, failOnce: false, throwsAfterCommit: false },
  { grant: true, saved: true, expectedExecutions: 1, failOnce: true, throwsAfterCommit: false },
  {
    grant: true,
    saved: true,
    expectedExecutions: 1,
    failOnce: true,
    throwsAfterCommit: false,
    navigate: true,
  },
  {
    grant: true,
    saved: true,
    expectedExecutions: 1,
    failOnce: true,
    throwsAfterCommit: false,
    advance: true,
  },
  { grant: true, saved: true, expectedExecutions: 1, failOnce: true, throwsAfterCommit: true },
])(
  "browser effects require a committed grant and retries preserve outcomes: grant=$grant saved=$saved retry=$failOnce uncertain=$throwsAfterCommit navigation=$navigate advance=$advance questionnaire=$questionnaire delayed=$delayed",
  async ({
    grant,
    saved,
    expectedExecutions,
    failOnce,
    throwsAfterCommit,
    navigate,
    advance,
    questionnaire,
    delayed,
  }) => {
    const toolName = questionnaire ? "ask_questionnaire" : "change_data"
    let chatRequests = 0
    let mutations = 0
    let signedInUser = currentUser
    let finishTool: () => void = () => {}
    const toolFinished = new Promise<void>((resolve) => {
      finishTool = resolve
    })
    const delivered = expectedExecutions > 0 && delayed !== "api" && delayed !== "identity"
    const execute = vi.fn(async () => {
      mutations++
      if (delayed) await toolFinished
      if (throwsAfterCommit) throw new TypeError("Response lost after mutation")
      return { changed: true }
    })
    let phase: "empty" | "decision" | "resolved" = "empty"
    let targetClientId = ""
    let resultBody: unknown
    let resultRequests = 0
    const events = (chunks: unknown[]) =>
      new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      })
    const assistant = {
      id: "assistant",
      role: "assistant",
      created_at: thread.created_at,
      parts: [
        {
          id: "application-part",
          type: "tool-call",
          toolCallId: "provider-call",
          name: toolName,
          arguments: "{}",
          input: {},
          state: "input-complete",
        },
      ],
    }
    const previous = [
      {
        ...assistant,
        id: "previous-assistant",
        parts: assistant.parts.map((part) => ({ ...part, id: "previous-part" })),
      },
      {
        id: "previous-result",
        role: "tool",
        created_at: thread.created_at,
        source_assistant_message_id: "previous-assistant",
        source_tool_part_id: "previous-part",
        parts: [
          {
            type: "tool-result",
            toolCallId: "provider-call",
            outcome: "succeeded",
            output: { previous: true },
          },
        ],
      },
    ]
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      new Request(input, init)
      const path = String(input)
      if (path.endsWith("/me")) return Promise.resolve(Response.json(signedInUser))
      if (path.includes("/messages?"))
        return Promise.resolve(
          Response.json({
            ...page([...previous, ...(phase === "empty" ? [] : [assistant])]),
            pending_interactions:
              phase === "decision"
                ? [
                    {
                      source_message_id: "assistant",
                      source_part_id: "application-part",
                      response_target_id: "target",
                      tool_call_id: "provider-call",
                      target_tenant_user_id: "user",
                      target_client_id: targetClientId,
                      execution_location: "browser",
                    },
                  ]
                : [],
          }),
        )
      if (path.endsWith("/tool-results")) {
        if (typeof init?.body !== "string") throw new Error("Expected a tool result body")
        resultBody = JSON.parse(init.body)
        resultRequests++
        if (failOnce && resultRequests === 1) return Promise.reject(new TypeError("Disconnected"))
        phase = "resolved"
        return Promise.resolve(
          events([
            { type: "RUN_STARTED", threadId: thread.id, runId: "continued" },
            {
              type: "RUN_FINISHED",
              threadId: thread.id,
              runId: "continued",
              metadata: { tanstack: { finishReason: "stop" } },
            },
          ]),
        )
      }
      if (path.endsWith("/chat")) {
        chatRequests++
        if (phase === "decision")
          return Promise.resolve(
            events([
              { type: "RUN_STARTED", threadId: thread.id, runId: "independent" },
              {
                type: "CUSTOM",
                name: "astralbeam_thread",
                value: { threadId: thread.id, version: 3, acceptedMessageId: "another-input" },
              },
              { type: "RUN_FINISHED", threadId: thread.id, runId: "independent" },
            ]),
          )
        if (typeof init?.body !== "string") throw new Error("Expected a chat body")
        targetClientId = (JSON.parse(init.body) as { forwardedProps: { clientId: string } })
          .forwardedProps.clientId
        phase = "decision"
        return Promise.resolve(
          events([
            { type: "RUN_STARTED", threadId: thread.id, runId: "initial" },
            {
              type: "CUSTOM",
              name: "astralbeam_thread",
              value: {
                threadId: thread.id,
                version: 2,
                acceptedMessageId: "input",
                saved,
                executableToolCallIds: grant ? ["provider-call"] : [],
              },
            },
            {
              type: "TOOL_CALL_START",
              toolCallId: "provider-call",
              toolCallName: toolName,
              parentMessageId: "assistant",
            },
            { type: "TOOL_CALL_ARGS", toolCallId: "provider-call", delta: "{}" },
            { type: "TOOL_CALL_END", toolCallId: "provider-call" },
            {
              type: "MESSAGES_SNAPSHOT",
              messages: [
                {
                  id: "previous-assistant",
                  role: "assistant",
                  content: "",
                  toolCalls: [
                    {
                      id: "provider-call",
                      type: "function",
                      function: { name: toolName, arguments: "{}" },
                    },
                  ],
                },
                {
                  id: "previous-result",
                  role: "tool",
                  toolCallId: "provider-call",
                  content: JSON.stringify({ previous: true }),
                },
                {
                  id: "assistant",
                  role: "assistant",
                  content: "",
                  toolCalls: [
                    {
                      id: "provider-call",
                      type: "function",
                      function: { name: toolName, arguments: "{}" },
                    },
                  ],
                },
              ],
            },
            {
              type: "RUN_FINISHED",
              threadId: thread.id,
              runId: "initial",
              metadata: { tanstack: { finishReason: "tool_calls" } },
              outcome: {
                type: "interrupt",
                interrupts: [
                  {
                    id: "client_tool_provider-call",
                    reason: "tanstack:client_tool_execution",
                    toolCallId: "provider-call",
                    metadata: { kind: "client_tool", toolName, input: {} },
                  },
                ],
              },
            },
          ]),
        )
      }
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    })
    const chat = createAstralBeamChat({
      threadId: thread.id,
      fetchAstralBeamToken: token,
      tools: {
        change_data: { description: "Change data", execute },
      },
    })
    try {
      await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
      const sending = chat.sendMessage("Change it")
      if (delayed) {
        await vi.waitUntil(() => execute.mock.calls.length === 1)
        chat.reset()
        if (delayed === "api") chat.updateOptions({ apiUrl: "https://replacement.example/api" })
        if (delayed === "identity") {
          signedInUser = { ...currentUser, user: { id: "another-user" } }
          chat.retryAuthentication()
          await vi.waitUntil(() => {
            const auth = chat.getState().auth
            return auth.status === "ready" && auth.currentUser.user.id === signedInUser.user.id
          })
        }
        if (delayed === "reopen") await chat.openThread(thread.id)
        finishTool()
        await sending
        if (delayed !== "reopen") await chat.openThread(thread.id)
        await chat.reload()
      } else await sending
      await vi.waitFor(() => expect(resultRequests).toBe(failOnce || delivered ? 1 : 0))
      if (failOnce) {
        if (navigate) await chat.openThread(thread.id)
        else if (advance) await chat.sendMessage("An independent input")
        else await chat.refreshThread()
        await chat.reload()
      }
      await vi.waitFor(() => expect(resultRequests).toBe(failOnce ? 2 : delivered ? 1 : 0))
      expect(chat.getState().error).toBeUndefined()
      expect(execute).toHaveBeenCalledTimes(expectedExecutions)
      const expectedResult: unknown = expect.objectContaining({
        results: [
          {
            source_message_id: "assistant",
            source_part_id: "application-part",
            response_target_id: "target",
            outcome: throwsAfterCommit ? "unknown" : "succeeded",
            output: throwsAfterCommit
              ? { error: "Response lost after mutation" }
              : {
                  content: [{ type: "text", text: '{"changed":true}' }],
                  structuredContent: { changed: true },
                },
          },
        ],
      })
      await vi.waitFor(() => expect(resultBody).toEqual(delivered ? expectedResult : undefined))
      expect(execute).toHaveBeenCalledTimes(expectedExecutions)
      expect(mutations).toBe(expectedExecutions)
      if (questionnaire) await chat.sendMessage("Leave the question unanswered")
      expect(chatRequests).toBe(questionnaire || advance ? 2 : 1)
      expect(chat.getState().error).toBeUndefined()
      expect(chat.getState().pendingInteractions).toHaveLength(delivered ? 0 : 1)
      expect(chat.getState().messages[0]?.parts[0]).toMatchObject({ output: { previous: true } })
    } finally {
      chat.dispose()
    }
  },
)

test("retained outcomes retry by source without loading older source messages", async () => {
  const pending = ["first", "second"].map((source) => ({
    source_message_id: source,
    source_part_id: "part",
    response_target_id: `${source}-target`,
    tool_call_id: "reused-provider-id",
    target_tenant_user_id: "user",
    target_client_id: "previous-client",
    execution_location: "browser",
  }))
  const requests: Array<Array<Record<string, unknown>>> = []
  const accepted = new Set<string>()
  let disconnected = true
  let newestPageOnly = false
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...page(
            pending.slice(newestPageOnly ? 1 : 0).map((item) => ({
              id: item.source_message_id,
              role: "assistant",
              state: "complete",
              created_at: thread.created_at,
              parts: [
                {
                  id: "part",
                  type: "tool-call",
                  toolCallId: item.tool_call_id,
                  name: "ask_questionnaire",
                  arguments: "{}",
                  input: {},
                  state: "input-complete",
                },
              ],
            })),
          ),
          page_after: newestPageOnly ? "older" : null,
          pending_interactions: pending.filter((item) => !accepted.has(item.source_message_id)),
        }),
      )
    if (path.endsWith("/tool-results") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { results: Array<Record<string, unknown>> }
      requests.push(body.results)
      if (disconnected) return Promise.reject(new TypeError("Disconnected"))
      for (const result of body.results) accepted.add(String(result.source_message_id))
      return Promise.resolve(Response.json({ thread_version: 2 }))
    }
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({ threadId: thread.id, fetchAstralBeamToken: token })
  try {
    await vi.waitFor(() => expect(chat.getState().pendingInteractions).toHaveLength(2))
    for (const item of pending)
      await chat.addToolResult({
        toolCallId: `saved:${item.source_message_id}:part:${item.response_target_id}`,
        tool: "ask_questionnaire",
        output: { answer: item.source_message_id },
      })
    newestPageOnly = true
    await chat.refreshThread()
    expect(chat.getState().messages.map((message) => message.id)).toEqual(["second"])
    disconnected = false
    await chat.reload()
    expect(requests.map((results) => results.map((result) => result.source_message_id))).toEqual([
      ["first"],
      ["second"],
      ["first"],
      ["second"],
    ])
    expect(requests.slice(2).flat()).toEqual(
      pending.map((item) => ({
        source_message_id: item.source_message_id,
        source_part_id: item.source_part_id,
        response_target_id: item.response_target_id,
        outcome: "succeeded",
        output: { answer: item.source_message_id },
      })),
    )
    expect(chat.getState().pendingInteractions).toEqual([])
    expect(chat.getState().error).toBeUndefined()
  } finally {
    chat.dispose()
  }
})

test("server-side revocation interrupts generation and blocks subsequent sends", async () => {
  let record = { ...thread }
  let sends = 0
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const response = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller
    },
  })
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?"))
      return Promise.resolve(Response.json({ ...page(), thread: record }))
    if (path.includes("/threads?"))
      return Promise.resolve(
        Response.json({ items: [record], page_after: null, page_before: null }),
      )
    if (path.endsWith("/chat")) {
      sends++
      const chunks = [
        { type: "RUN_STARTED", threadId: thread.id, runId: "run" },
        { type: "TEXT_MESSAGE_START", messageId: "assistant", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "assistant", delta: "Working" },
      ]
      stream.enqueue(
        new TextEncoder().encode(
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
        ),
      )
      return Promise.resolve(
        new Response(response, { headers: { "Content-Type": "text/event-stream" } }),
      )
    }
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({ threadId: thread.id, fetchAstralBeamToken: token })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    const send = chat.sendMessage("Start")
    await vi.waitFor(() => expect(chat.getState().status).toBe("streaming"))
    record = { ...record, role: "viewer", version: record.version + 1 }
    stream.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "RUN_ERROR", message: "Write access was revoked." })}\n\n`,
      ),
    )
    stream.close()
    await send
    expect(chat.getState().thread?.role).toBe("viewer")
    expect(chat.getState().error?.message).toContain("Write access was revoked")
    await chat.sendMessage("A new input")
    expect(sends).toBe(1)
    expect(chat.getState().error?.message).toContain("read-only")
  } finally {
    chat.dispose()
  }
})

test("a browser tool and widget can continue through consecutive committed turns", async () => {
  let phase = 0
  const executed = vi.fn(() => ({ done: true }))
  const rendered = vi.fn()
  const outputs: unknown[] = []
  const input = {}
  const call = (index: number) => ({
    id: `part-${index}`,
    type: "tool-call",
    toolCallId: "reused-call",
    name: index === 1 ? "change_data" : "show_card",
    arguments: JSON.stringify(index === 1 ? {} : input),
    input: index === 1 ? {} : input,
    state: "input-complete",
  })
  const stream = (index: number, runId: string) => {
    const part = call(index)
    const run = { threadId: thread.id, runId }
    const chunks = [
      { type: "RUN_STARTED", ...run },
      {
        type: "CUSTOM",
        name: "astralbeam_thread",
        value: {
          threadId: thread.id,
          version: index,
          saved: true,
          acceptedMessageId: "user",
          executableToolCallIds: index < 3 ? [part.toolCallId] : [],
        },
      },
      ...(index < 3
        ? [
            {
              type: "TOOL_CALL_START",
              parentMessageId: `assistant-${index}`,
              toolCallId: part.toolCallId,
              toolCallName: part.name,
            },
            { type: "TOOL_CALL_ARGS", toolCallId: part.toolCallId, delta: part.arguments },
            { type: "TOOL_CALL_END", toolCallId: part.toolCallId },
            {
              type: "MESSAGES_SNAPSHOT",
              messages: [
                {
                  id: `assistant-${index}`,
                  role: "assistant",
                  content: "",
                  toolCalls: [
                    {
                      id: part.toolCallId,
                      type: "function",
                      function: { name: part.name, arguments: part.arguments },
                    },
                  ],
                },
              ],
            },
          ]
        : []),
      {
        type: "RUN_FINISHED",
        ...run,
        metadata: { tanstack: { finishReason: index < 3 ? "tool_calls" : "stop" } },
        ...(index < 3
          ? {
              outcome: {
                type: "interrupt",
                interrupts: [
                  {
                    id: `client_tool_${part.toolCallId}`,
                    reason: "tanstack:client_tool_execution",
                    toolCallId: part.toolCallId,
                    responseSchema: {},
                    metadata: {
                      kind: "client_tool",
                      toolName: part.name,
                      input: part.input,
                      "tanstack:interruptBinding": {
                        v: 1,
                        kind: "client-tool-execution",
                        interruptId: `client_tool_${part.toolCallId}`,
                        toolName: part.name,
                        toolCallId: part.toolCallId,
                        interruptedRunId: runId,
                        generation: 0,
                        outputSchemaHash:
                          "sha256:eb045d78d273107348b0300c01d29b7552d622abbc6faf81b3ec55359aa9950c",
                        responseSchemaHash:
                          "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
                      },
                    },
                  },
                ],
              },
            }
          : {}),
      },
    ]
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    })
  }
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    new Request(url, init)
    const path = String(url)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...page(
            phase > 0
              ? [
                  {
                    id: `assistant-${phase}`,
                    role: "assistant",
                    created_at: thread.created_at,
                    parts: [call(phase)],
                  },
                ]
              : [],
          ),
          pending_interactions:
            phase > 0 && phase < 3
              ? [
                  {
                    source_message_id: `assistant-${phase}`,
                    source_part_id: `part-${phase}`,
                    response_target_id: `target-${phase}`,
                    tool_call_id: "reused-call",
                    target_tenant_user_id: "user",
                    target_client_id: null,
                    execution_location: "browser",
                  },
                ]
              : [],
        }),
      )
    if (path.endsWith("/chat")) {
      phase = 1
      if (typeof init?.body !== "string") throw new Error("Expected a chat request body")
      return Promise.resolve(stream(phase, (JSON.parse(init.body) as { runId: string }).runId))
    }
    if (path.endsWith("/tool-results")) {
      if (typeof init?.body !== "string") throw new Error("Expected a tool-result request body")
      const body = JSON.parse(init.body) as { run_id?: string }
      outputs.push(body)
      return Promise.resolve(stream(++phase, body.run_id ?? "server-generated-run"))
    }
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
    tools: { change_data: { description: "Change", execute: executed } },
    widgets: { card: { description: "Card" } },
    onRenderWidget: rendered,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread).toBeDefined())
    await chat.sendMessage("Change and show")
    expect(executed).toHaveBeenCalledTimes(1)
    expect(rendered).toHaveBeenCalledTimes(1)
    expect(outputs).toEqual([
      expect.objectContaining({
        results: [
          expect.objectContaining({
            source_message_id: "assistant-1",
            output: {
              content: [{ type: "text", text: '{"done":true}' }],
              structuredContent: { done: true },
            },
          }),
        ],
      }),
      expect.objectContaining({
        results: [
          expect.objectContaining({
            source_message_id: "assistant-2",
            output: { content: [{ type: "text", text: "Displayed card" }] },
          }),
        ],
      }),
    ])
    expect(chat.getState().error).toBeUndefined()
    expect(chat.getState().pendingInteractions).toEqual([])
  } finally {
    chat.dispose()
  }
})

test("older history is requested explicitly and rejoins tool results across page boundaries", async () => {
  const pages: string[] = []
  const assistant = {
    id: "assistant",
    role: "assistant",
    created_at: thread.created_at,
    parts: [
      {
        type: "tool-call",
        id: "part",
        toolCallId: "call",
        name: "change_data",
        arguments: "{}",
        state: "input-complete",
      },
    ],
  }
  const result = {
    id: "result",
    role: "tool",
    created_at: thread.created_at,
    source_assistant_message_id: "assistant",
    source_tool_part_id: "part",
    parts: [{ type: "tool-result", outcome: "succeeded", output: { complete: true } }],
  }
  const user = {
    id: "user",
    role: "user",
    created_at: thread.created_at,
    parts: [{ type: "text", content: "Latest" }],
  }
  vi.stubGlobal("fetch", (input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (url.pathname.endsWith("/messages")) {
      pages.push(url.search)
      return Promise.resolve(
        Response.json(
          url.searchParams.has("page_after")
            ? page([assistant])
            : { ...page([result, user]), page_after: "older" },
        ),
      )
    }
    if (url.pathname.endsWith("/threads"))
      return Promise.resolve(Response.json({ items: [thread], page_after: null }))
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread).toBeDefined())
    expect(pages).toHaveLength(1)
    expect(chat.getState().messages.map((message) => message.id)).toEqual(["user"])
    await chat.loadOlderMessages()
    expect(pages).toHaveLength(2)
    expect(chat.getState().messages.map((message) => message.id)).toEqual(["assistant", "user"])
    expect(chat.getState().messages[0]?.parts[0]).toMatchObject({
      state: "complete",
      output: { complete: true },
    })
    expect(chat.getState().messagesCursor).toBeUndefined()
  } finally {
    chat.dispose()
  }
})

test("hydrated results address an unloaded target when concurrent calls reuse a provider ID", async () => {
  const execute = vi.fn()
  const submitted: Array<Record<string, unknown>> = []
  const sources = [
    { message: "first", targets: ["first-target", "second-target"] },
    { message: "second", targets: ["third-target"] },
  ]
  const pending = sources.flatMap(({ message, targets }) =>
    targets.map((target) => ({
      source_message_id: message,
      source_part_id: "part",
      response_target_id: target,
      tool_call_id: "reused-provider-id",
      target_tenant_user_id: "user",
      target_client_id: "previous-client",
      execution_location: "browser",
    })),
  )
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.includes("/messages?"))
      return Promise.resolve(
        Response.json({
          ...page(
            sources.slice(1).map(({ message, targets }) => ({
              id: message,
              role: "assistant",
              state: "complete",
              created_at: thread.created_at,
              parts: [
                {
                  id: "part",
                  type: "tool-call",
                  toolCallId: "reused-provider-id",
                  name: "change_data",
                  arguments: "{}",
                  state: "input-complete",
                  targets: targets.map((id) => ({ id })),
                },
              ],
            })),
          ),
          thread: { ...thread, writer_active: true },
          pending_interactions: pending.filter(
            (item) =>
              !submitted.some((result) => result.response_target_id === item.response_target_id),
          ),
        }),
      )
    if (path.endsWith("/tool-results") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { results: Array<Record<string, unknown>> }
      submitted.push(...body.results)
      return Promise.resolve(Response.json({ thread_version: 2 }))
    }
    return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
    tools: { change_data: { description: "Change", execute } },
  })
  try {
    await vi.waitFor(() => expect(chat.getState().pendingInteractions).toHaveLength(3))
    expect(
      chat
        .getState()
        .messages.flatMap((message) =>
          message.parts.map((part) => (part.type === "tool-call" ? part.id : null)),
        ),
    ).toEqual(["saved:second:part:third-target"])
    await chat.abandonToolCall("saved:first:part:first-target")
    expect(submitted).toEqual([
      {
        source_message_id: "first",
        source_part_id: "part",
        response_target_id: "first-target",
        outcome: "unknown",
        output: null,
      },
    ])
    expect(chat.getState().pendingInteractions).toHaveLength(2)
    expect(execute).not.toHaveBeenCalled()
  } finally {
    chat.dispose()
  }
})

test("a late hydration response cannot replace a newly selected conversation", async () => {
  const next = { ...thread, id: "00000000-0000-4000-8000-000000000003" }
  let resolveFirst: ((response: Response) => void) | undefined
  vi.stubGlobal("fetch", (input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (url.pathname.endsWith("/config"))
      return Promise.resolve(Response.json({ attachments: true }))
    if (url.pathname.endsWith("/threads"))
      return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
    if (url.pathname.includes(thread.id))
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve
      })
    return Promise.resolve(
      Response.json({
        ...page([
          {
            id: "second",
            role: "user",
            state: "complete",
            created_at: next.created_at,
            author_tenant_user_id: "user",
            parts: [{ id: "text", type: "text", content: "Second thread" }],
          },
        ]),
        thread: next,
      }),
    )
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(resolveFirst).toBeDefined())
    await chat.openThread(next.id)
    resolveFirst!(Response.json(page()))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(chat.getState().thread?.id).toBe(next.id)
    expect(chat.getState().messages[0]?.id).toBe("second")
    expect(chat.getState().threadLoading).toBe(false)
    expect(chat.getState().error).toBeUndefined()
  } finally {
    chat.dispose()
  }
})

test("failed native hydration blocks sends until a successful reload", async () => {
  let failed = true
  const sends = vi.fn()
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/config")) return Promise.resolve(Response.json({ attachments: true }))
    if (path.endsWith("/threads"))
      return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
    if (path.endsWith("/messages"))
      return failed
        ? Promise.reject(new TypeError("History unavailable"))
        : Promise.resolve(Response.json(page()))
    sends()
    return Promise.reject(new Error("Generation is not expected"))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().threadLoadFailed).toBe(true))
    await chat.sendMessage("Do not send against missing history")
    expect(sends).not.toHaveBeenCalled()
    failed = false
    await chat.openThread(thread.id)
    expect(chat.getState().threadLoadFailed).toBe(false)
    expect(chat.getState().threadLoading).toBe(false)
    expect(chat.getState().error).toBeUndefined()
  } finally {
    chat.dispose()
  }
})

test("saved threads use their bound agent capabilities and reset uses the configured agent", async () => {
  const agents: Array<string | null> = []
  vi.stubGlobal("fetch", (input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (url.pathname.endsWith("/config")) {
      const agent = url.searchParams.get("agentId")
      agents.push(agent)
      return Promise.resolve(
        Response.json({ capabilities: { attachments: agent !== "saved-agent" } }),
      )
    }
    if (url.pathname.endsWith("/messages"))
      return Promise.resolve(
        Response.json({ ...page(), thread: { ...thread, agent_id: "saved-agent" } }),
      )
    return Promise.resolve(Response.json({ items: [thread], page_after: null }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    agentId: "configured-agent",
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(false))
    expect(agents.at(-1)).toBe("saved-agent")
    chat.updateOptions({ agentId: "new-default" })
    await vi.waitFor(() =>
      expect(agents.filter((agent) => agent === "saved-agent")).toHaveLength(2),
    )
    chat.reset()
    await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(true))
    expect(agents.at(-1)).toBe("new-default")
  } finally {
    chat.dispose()
  }
})

test.each(["auto", thread.id])(
  "inaccessible %s selections recover only automatic restoration",
  async (threadId) => {
    let stored: string | null = thread.id
    vi.stubGlobal("sessionStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value
      },
      removeItem: () => {
        stored = null
      },
    })
    vi.stubGlobal("fetch", (input: string | URL) => {
      const path = new URL(input).pathname
      if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
      if (path.endsWith("/messages"))
        return Promise.resolve(
          Response.json(
            {
              status: 404,
              title: "Not found",
              detail: "Conversation not found.",
            },
            { status: 404 },
          ),
        )
      if (path.endsWith("/config"))
        return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
      return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
    })
    const chat = createAstralBeamChat({ threadId, fetchAstralBeamToken: token })
    try {
      await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
      await vi.waitFor(() => expect(chat.getState().threadLoading).toBe(false))
      expect(chat.getState().threadLoadFailed).toBe(threadId !== "auto")
      expect(stored).toBe(threadId === "auto" ? null : thread.id)
      expect(chat.getState().error === undefined).toBe(threadId === "auto")
    } finally {
      chat.dispose()
    }
  },
)

test("a deleted agent disables generation without resolving the default agent", async () => {
  const fallback = vi.fn()
  const send = vi.fn()
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/messages"))
      return Promise.resolve(Response.json({ ...page(), thread: { ...thread, agent_id: null } }))
    if (path.endsWith("/config")) {
      fallback()
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    }
    if (path.endsWith("/chat")) send()
    return Promise.resolve(Response.json({ items: [], page_after: null, page_before: null }))
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    agentId: "configured-agent",
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.agentId).toBeNull())
    await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(false))
    const prior = fallback.mock.calls.length
    chat.updateOptions({ agentId: "different-default" })
    await chat.sendMessage("Must not send")
    expect(fallback).toHaveBeenCalledTimes(prior)
    expect(send).not.toHaveBeenCalled()
    expect(chat.getState().error?.message).toContain("agent is unavailable")
  } finally {
    chat.dispose()
  }
})

test("refresh after membership removal leaves a fresh conversation without an error", async () => {
  let removed = false
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/messages") && removed)
      return Promise.resolve(
        Response.json(
          { status: 404, title: "Not found", detail: "Conversation not found." },
          { status: 404 },
        ),
      )
    if (path.endsWith("/messages")) return Promise.resolve(Response.json(page()))
    if (path.endsWith("/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    return Promise.resolve(
      Response.json({ items: removed ? [] : [thread], page_after: null, page_before: null }),
    )
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    removed = true
    await chat.refreshThread()
    expect(chat.getState().thread).toBeUndefined()
    expect(chat.getState().error).toBeUndefined()
  } finally {
    chat.dispose()
  }
})

test("a host update during send keeps metadata paired with the captured tools", async () => {
  let body:
    | {
        tools: { name: string }[]
        forwardedProps: { toolMetadata: Record<string, unknown> }
      }
    | undefined
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return Promise.resolve(Response.json(currentUser))
    if (path.endsWith("/config"))
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    if (path.endsWith("/messages")) return Promise.resolve(Response.json(page()))
    if (path.endsWith("/threads"))
      return Promise.resolve(Response.json({ items: [thread], page_after: null }))
    body = JSON.parse(init!.body as string) as typeof body
    const run = { threadId: thread.id, runId: "run" }
    const events = [
      { type: "RUN_STARTED", ...run },
      {
        type: "TOOL_CALL_START",
        parentMessageId: "assistant",
        toolCallId: "call",
        toolCallName: "old_tool",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "call", delta: "{}" },
      { type: "TOOL_CALL_END", toolCallId: "call" },
      { type: "RUN_FINISHED", ...run, metadata: { tanstack: { finishReason: "stop" } } },
    ]
    return Promise.resolve(
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      }),
    )
  })
  const chat = createAstralBeamChat({
    threadId: thread.id,
    fetchAstralBeamToken: token,
    tools: { old_tool: { description: "Old", widget: "card", execute: () => ({}) } },
    widgets: { card: { description: "Card" } },
    streamCallbacks: {
      onResponse: () =>
        chat.updateOptions({
          tools: { new_tool: { description: "New", execute: () => ({}) } },
        }),
    },
  })
  let streamedPart: unknown
  const unsubscribe = chat.subscribe(() => {
    const part = chat
      .getState()
      .messages.flatMap((message) => message.parts)
      .find((part) => part.type === "tool-call")
    if (part) streamedPart = { ...part }
  })
  try {
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    await chat.sendMessage("Check snapshot")
    expect(body!.tools.map((tool) => tool.name)).toContain("old_tool")
    expect(body!.forwardedProps.toolMetadata).toHaveProperty("old_tool")
    expect(body!.forwardedProps.toolMetadata).not.toHaveProperty("new_tool")
    expect(streamedPart).toMatchObject({ name: "old_tool", widget: "card" })
  } finally {
    unsubscribe()
    chat.dispose()
  }
})
