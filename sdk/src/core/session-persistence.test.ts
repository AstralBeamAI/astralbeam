import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { chatTestToken, createTestSession, disposeTestSessions } from "./session-fixtures.ts"
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
const page = (messages: unknown[] = []) => ({
  thread,
  messages,
  pending_interactions: [],
  page_after: null,
  page_before: null,
})

function sessionResponse(body: unknown, init?: ResponseInit) {
  return Promise.resolve(Response.json(body, init))
}

function stubSessionFetch(handler: (input: string | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) =>
    new URL(input).pathname.endsWith("/me") ? sessionResponse(currentUser) : handler(input, init),
  )
}

function savedAssistantMessage(part: Record<string, unknown>) {
  return {
    id: "assistant",
    role: "assistant",
    created_at: thread.created_at,
    parts: [{ type: "tool-call", arguments: "{}", state: "input-complete", ...part }],
  }
}

beforeEach(() => vi.stubGlobal("sessionStorage", undefined))
afterEach(() => {
  disposeTestSessions()
  vi.unstubAllGlobals()
})

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
    stubSessionFetch((input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/messages")) {
        const id = url.pathname.split("/").at(-2)!
        loads.push(id)
        return sessionResponse({ ...page(), thread: { ...thread, id } })
      }
      if (url.pathname.endsWith("/threads"))
        return sessionResponse({ items: [], page_after: null, page_before: null })
      return sessionResponse({ capabilities: { attachments: true } })
    })
    const chat = createTestSession({ threadId })
    await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(expected))
    expect(loads).toEqual(expected ? [expected] : [])
    chat.updateOptions({ threadId: "new" })
    expect(chat.getState().thread).toBeUndefined()
    expect(readLocal).not.toHaveBeenCalled()
  },
)

test("creates on first send, hides failed empty threads, and lists accepted titles", async () => {
  let created = 0
  let submissions = 0
  let accepted = false
  const empty = { ...thread, title: "", version: 0 }
  const saved = { ...thread, title: "First message" }
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith("/chat/config"))
      return sessionResponse({ capabilities: { attachments: true } })
    if (path.endsWith("/threads") && init?.method === "POST") {
      created++
      return sessionResponse(empty)
    }
    if (path.includes("/threads?"))
      return sessionResponse({
        items: accepted ? [saved] : [],
        page_after: null,
        page_before: null,
      })
    if (path.includes("/messages?"))
      return sessionResponse({
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
      })
    if (path.endsWith("/chat")) {
      submissions++
      if (submissions === 1) return Promise.resolve(new Response("Rejected input", { status: 400 }))
      accepted = true
      return sessionResponse({
        thread_id: saved.id,
        accepted_message_id: "accepted",
        thread_version: 1,
      })
    }
    return Promise.reject(new Error(`Unexpected request ${path}`))
  })
  const chat = createTestSession()
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
  expect(chat.getState().submission).toMatchObject({ phase: "refused", content: "First message" })
  await chat.sendMessage("First message")
  expect((await chat.searchThreads()).items[0]?.title).toBe("First message")
  expect(created).toBe(1)
  expect(chat.getState().thread?.hasMessages).toBe(true)
  expect(chat.getState().messages.find((message) => message.role === "user")?.id).toBe("accepted")
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
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    new Request(input, init)
    const path = String(input)
    if (path.endsWith("/chat/config"))
      return sessionResponse({ capabilities: { attachments: true } })
    if (path.includes("/messages?"))
      return sessionResponse({
        ...page(),
        thread: {
          ...thread,
          writer_active: true,
          role: changed && mode === "viewer" ? "viewer" : "manager",
          agent_id: changed && mode === "deleted" ? null : thread.agent_id,
        },
      })
    if (path.endsWith("/chat")) {
      if (typeof init?.body !== "string") throw new Error("Expected an AG-UI request body")
      sent.push({
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: JSON.parse(init.body) as (typeof sent)[number]["body"],
      })
      if (sent.length === 1) return Promise.reject(new TypeError("Connection lost after admission"))
      if (sent.length === 2)
        return sessionResponse({
          thread_id: thread.id,
          accepted_message_id: "accepted",
          thread_version: 2,
        })
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
  const chat = createTestSession({
    threadId: thread.id,
  })
  const onAccepted = vi.fn()
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  await chat.sendMessage("Hello", { onAccepted })
  expect(chat.getState().submission).toMatchObject({ phase: "failed", content: "Hello" })
  changed = true
  await chat.reload()
  expect(sent).toHaveLength(1)
  expect(chat.getState().submission).toMatchObject({ phase: "failed", content: "Hello" })
  const edited = await chat.sendMessage("Edited uncertain input")
  expect(sent).toHaveLength(1)
  expect(chat.getState().submission).toMatchObject({ phase: "failed", content: "Hello" })
  expect(edited).toMatchObject({ phase: "refused", content: "Edited uncertain input" })
  expect(edited.error?.message).toContain(downgraded ? denied : "acceptance is unconfirmed")
  chat.updateOptions({
    tools: { changed: { description: "Changed declaration", execute: () => null } },
  })
  await chat.retry()
  expect(sent).toHaveLength(2)
  expect(sent[0]?.key).toBeTruthy()
  expect(sent[1]?.key).toBe(sent[0]?.key)
  expect(sent[1]?.body.messages).toHaveLength(1)
  expect(sent[1]?.body.tools).toEqual(sent[0]?.body.tools)
  expect(chat.getState().submission?.phase).toBe("accepted")
  expect(chat.getState().error).toBeUndefined()
  expect(onAccepted).toHaveBeenCalledOnce()
  const another = await chat.sendMessage("Another intent")
  expect(sent).toHaveLength(downgraded ? 2 : 3)
  expect(sent.at(-1)?.key === sent[0]?.key).toBe(downgraded)
  expect(JSON.stringify(sent.at(-1)?.body.tools) === JSON.stringify(sent[0]?.body.tools)).toBe(
    downgraded,
  )
  expect(another.error?.message).toBe(downgraded ? denied : undefined)
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
    stubSessionFetch((input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname
      if (path.endsWith("/config")) return sessionResponse({ capabilities: { attachments: true } })
      if (path.endsWith("/messages")) return sessionResponse(page())
      if (path.endsWith("/threads")) return sessionResponse({ items: [thread], page_after: null })
      keys.push(new Headers(init?.headers).get("Idempotency-Key"))
      if (uncertain && keys.length === 1)
        return Promise.reject(new TypeError("Acknowledgment lost"))
      return sessionResponse(
        {
          type: "about:blank",
          title: "Rejected",
          status,
          detail: "Input was not admitted.",
        },
        { status },
      )
    })
    const chat = createTestSession({ threadId: thread.id })
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    await chat.sendMessage("Original input")
    if (uncertain) await chat.retry()
    const corrected = await chat.sendMessage("Corrected input")
    expect(keys).toHaveLength(2)
    expect(keys[1] === keys[0]).toBe(uncertain)
    expect(chat.getState().submission).toMatchObject({
      phase: uncertain ? "failed" : "refused",
      content: uncertain ? "Original input" : "Corrected input",
    })
    expect(corrected).toMatchObject({ phase: "refused", content: "Corrected input" })
    expect(corrected.error?.message).toContain(
      uncertain ? "acceptance is unconfirmed" : "Input was not admitted",
    )
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
      return sessionResponse({ capabilities: { attachments: true } })
    historyReads.push(path)
    return sessionResponse(page())
  })
  const chat = createTestSession({
    threadId: thread.id,
  })
  await vi.waitFor(() => expect(resolveIdentity).toBeDefined())
  chat.reset()
  resolveIdentity!(Response.json(currentUser))
  await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
  expect(chat.getState().thread).toBeUndefined()
  expect(historyReads).toEqual([])
})

test("opening saved tool calls restores their results without executing host tools", async () => {
  const execute = vi.fn()
  const messages = [
    savedAssistantMessage({
      id: "application-part",
      toolCallId: "provider-call",
      name: "change_data",
      input: {},
      declaration: { source: "mcp", title: "Work account: Change data" },
    }),
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
          savedToolTitle: "Work account: Change data",
        },
      ],
    },
  ]
  stubSessionFetch((input: string | URL) => {
    const path = String(input)
    if (path.includes("/messages?")) return sessionResponse(page(messages))
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({
    threadId: thread.id,
    tools: { change_data: { description: "Change data", execute } },
  })
  await vi.waitFor(() => expect(chat.getState().messages).toHaveLength(1))
  expect(chat.getState().messages[0]?.parts[0]).toMatchObject({
    id: "saved:assistant:application-part",
    upstreamToolCallId: "provider-call",
    applicationPartId: "application-part",
    state: "complete",
    output: { done: true },
  })
  expect(execute).not.toHaveBeenCalled()
})

test("changing API scope drops saved history before the replacement account resolves", async () => {
  const setItem = vi.fn()
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem })
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = String(input)
    if (path.startsWith("https://replacement.example")) return new Promise<Response>(() => {})
    if (path.endsWith("/me")) return sessionResponse(currentUser)
    if (path.includes("/messages?"))
      return sessionResponse(
        page([
          {
            id: "private",
            role: "user",
            created_at: thread.created_at,
            parts: [{ type: "text", content: "Private history" }],
          },
        ]),
      )
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({
    threadId: thread.id,
  })
  await vi.waitFor(() => expect(chat.getState().messages).toHaveLength(1))
  expect(setItem).toHaveBeenCalledWith(
    expect.stringContaining('["tenant","organization","tenant","user",null]'),
    thread.id,
  )
  chat.updateOptions({ apiUrl: "https://replacement.example/api" })
  expect(chat.getState().messages).toEqual([])
  expect(chat.getState().thread).toBeUndefined()
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
  const assistant = savedAssistantMessage({
    id: "application-part",
    toolCallId: "provider-call",
    name: "change_data",
    input: {},
  })
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.includes("/messages?"))
      return sessionResponse({
        ...page([assistant]),
        thread: { ...thread, writer_active: true },
        pending_interactions: posted ? [] : [pending],
      })
    if (path.endsWith("/tool-results")) {
      if (typeof init?.body !== "string") throw new Error("Expected a tool result body")
      posted = JSON.parse(init.body) as NonNullable<typeof posted>
      return sessionResponse({
        thread_id: thread.id,
        accepted_message_id: "resolution",
        thread_version: 2,
      })
    }
    if (path.endsWith("/chat")) throw new Error("A tool result must not resubmit a user message")
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({
    threadId: thread.id,
    tools: { change_data: { description: "Change data", execute } },
  })
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
})

const browserEffectDefaults = {
  grant: true,
  saved: true,
  expectedExecutions: 1,
  failOnce: false,
  throwsAfterCommit: false,
}

test.each<
  typeof browserEffectDefaults & {
    navigate?: boolean
    advance?: boolean
    questionnaire?: boolean
    delayed?: string
    validation?: string
  }
>([
  ...[
    "unchanged",
    "dispose-remount",
    "verified-identity",
    "selection-reset",
    "stop",
    "removed-tool",
    "changed-schema",
    "current-callback",
    "reject-validation",
  ].map((validation) => ({
    ...browserEffectDefaults,
    validation,
    expectedExecutions: ["unchanged", "current-callback"].includes(validation) ? 1 : 0,
  })),
  { ...browserEffectDefaults, delayed: "navigation" },
  { ...browserEffectDefaults, delayed: "reopen" },
  { ...browserEffectDefaults, delayed: "api" },
  { ...browserEffectDefaults, delayed: "identity" },
  { ...browserEffectDefaults, expectedExecutions: 0, questionnaire: true },
  browserEffectDefaults,
  { ...browserEffectDefaults, grant: false, expectedExecutions: 0 },
  { ...browserEffectDefaults, saved: false, expectedExecutions: 0 },
  { ...browserEffectDefaults, failOnce: true },
  { ...browserEffectDefaults, failOnce: true, navigate: true },
  { ...browserEffectDefaults, failOnce: true, advance: true },
  { ...browserEffectDefaults, failOnce: true, throwsAfterCommit: true },
])(
  "browser effects require a committed grant and retries preserve outcomes: grant=$grant saved=$saved retry=$failOnce uncertain=$throwsAfterCommit navigation=$navigate advance=$advance questionnaire=$questionnaire delayed=$delayed validation=$validation",
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
    validation,
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
    const pendingValidation = Promise.withResolvers<unknown>()
    const parameters = {
      "~standard": {
        version: 1 as const,
        vendor: "delayed-validator",
        validate: vi.fn((input: unknown) =>
          pendingValidation.promise.then((result) => result ?? { value: input }),
        ),
      },
    }
    const replacement = vi.fn(() => {
      mutations++
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
    const assistant = savedAssistantMessage({
      id: "application-part",
      toolCallId: "provider-call",
      name: toolName,
      input: {},
    })
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
      if (path.endsWith("/me")) return sessionResponse(signedInUser)
      if (path.includes("/messages?"))
        return sessionResponse({
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
        })
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
        if (validation && signedInUser.user.id !== currentUser.user.id)
          throw new Error("A stale tool started a request for another identity")
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
      return sessionResponse({ capabilities: { attachments: true } })
    })
    const chat = createTestSession({
      threadId: thread.id,
      tools: {
        change_data: {
          description: "Change data",
          ...(validation ? { parameters } : {}),
          execute,
        },
      },
    })
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    const sending = chat.sendMessage("Change it")
    let mutationsBeforeValidation: number | undefined
    if (validation) {
      await vi.waitUntil(() => parameters["~standard"].validate.mock.calls.length === 1)
      mutationsBeforeValidation = mutations
      if (validation === "dispose-remount" || validation === "verified-identity") {
        signedInUser = { ...currentUser, user: { id: "another-user" } }
        if (validation === "dispose-remount") {
          chat.dispose()
          const remounted = createTestSession({ threadId: "new" })
          await vi.waitUntil(() => remounted.getState().auth.status === "ready")
        } else {
          chat.retryAuthentication()
          await vi.waitUntil(() => {
            const auth = chat.getState().auth
            return auth.status === "ready" && auth.currentUser.user.id === signedInUser.user.id
          })
        }
      } else if (validation === "selection-reset") chat.reset()
      else if (validation === "stop") chat.stop()
      else if (validation === "removed-tool") chat.updateOptions({ tools: {} })
      else if (validation === "changed-schema" || validation === "current-callback")
        chat.updateOptions({
          tools: {
            change_data: {
              description: "Change data",
              parameters: validation === "changed-schema" ? { ...parameters } : parameters,
              execute: replacement,
            },
          },
        })
      pendingValidation.resolve(
        validation === "reject-validation"
          ? { issues: [{ message: "Rejected input" }] }
          : undefined,
      )
      await sending
    } else if (delayed) {
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
    expect(mutationsBeforeValidation).toBe(validation ? 0 : undefined)
    expect(execute).toHaveBeenCalledTimes(
      validation === "current-callback" ? 0 : expectedExecutions,
    )
    expect(replacement).toHaveBeenCalledTimes(validation === "current-callback" ? 1 : 0)
    expect(mutations).toBe(expectedExecutions)
    expect(chatRequests).toBe(1)
    if (validation) return
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
          output: throwsAfterCommit ? { error: "Response lost after mutation" } : { changed: true },
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
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.includes("/messages?"))
      return sessionResponse({
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
      })
    if (path.endsWith("/tool-results") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { results: Array<Record<string, unknown>> }
      requests.push(body.results)
      if (disconnected) return Promise.reject(new TypeError("Disconnected"))
      for (const result of body.results) accepted.add(String(result.source_message_id))
      return sessionResponse({ thread_version: 2 })
    }
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({ threadId: thread.id })
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
  stubSessionFetch((input: string | URL) => {
    const path = String(input)
    if (path.includes("/messages?")) return sessionResponse({ ...page(), thread: record })
    if (path.includes("/threads?"))
      return sessionResponse({ items: [record], page_after: null, page_before: null })
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
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({ threadId: thread.id })
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
  expect(chat.getState().submission?.error?.message).toContain("Write access was revoked")
  expect((await chat.sendMessage("A new input")).error?.message).toContain("read-only")
  expect(sends).toBe(1)
})

test("a browser tool and widget can continue through consecutive committed turns", async () => {
  let phase = 0
  const executed = vi.fn(() => ({ done: true }))
  const rendered = vi.fn()
  const outputs: unknown[] = []
  const input = { widget: "card", props: {} }
  const call = (index: number) => ({
    id: `part-${index}`,
    type: "tool-call",
    toolCallId: "reused-call",
    name: index === 1 ? "change_data" : "render_widget",
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
  stubSessionFetch((url: string | URL, init?: RequestInit) => {
    new Request(url, init)
    const path = String(url)
    if (path.includes("/messages?"))
      return sessionResponse({
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
      })
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
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({
    threadId: thread.id,
    tools: { change_data: { description: "Change", execute: executed } },
    widgets: { card: { description: "Card" } },
    onRenderWidget: rendered,
  })
  await vi.waitFor(() => expect(chat.getState().thread).toBeDefined())
  await chat.sendMessage("Change and show")
  expect(executed).toHaveBeenCalledTimes(1)
  expect(rendered).toHaveBeenCalledTimes(1)
  expect(outputs).toEqual([
    expect.objectContaining({
      results: [
        expect.objectContaining({ source_message_id: "assistant-1", output: { done: true } }),
      ],
    }),
    expect.objectContaining({
      results: [
        expect.objectContaining({
          source_message_id: "assistant-2",
          output: { widget: "card", rendered: true },
        }),
      ],
    }),
  ])
  expect(chat.getState().error).toBeUndefined()
  expect(chat.getState().pendingInteractions).toEqual([])
})

test("older history is requested explicitly and rejoins tool results across page boundaries", async () => {
  const pages: string[] = []
  const assistant = savedAssistantMessage({
    id: "part",
    toolCallId: "call",
    name: "change_data",
  })
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
  stubSessionFetch((input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/messages")) {
      pages.push(url.search)
      return sessionResponse(
        url.searchParams.has("page_after")
          ? page([assistant])
          : { ...page([result, user]), page_after: "older" },
      )
    }
    if (url.pathname.endsWith("/threads"))
      return sessionResponse({ items: [thread], page_after: null })
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({
    threadId: thread.id,
  })
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
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.includes("/messages?"))
      return sessionResponse({
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
      })
    if (path.endsWith("/tool-results") && typeof init?.body === "string") {
      const body = JSON.parse(init.body) as { results: Array<Record<string, unknown>> }
      submitted.push(...body.results)
      return sessionResponse({ thread_version: 2 })
    }
    return sessionResponse({ capabilities: { attachments: true } })
  })
  const chat = createTestSession({
    threadId: thread.id,
    tools: { change_data: { description: "Change", execute } },
  })
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
})

test("a late hydration response cannot replace a newly selected conversation", async () => {
  const next = { ...thread, id: "00000000-0000-4000-8000-000000000003" }
  let resolveFirst: ((response: Response) => void) | undefined
  stubSessionFetch((input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/config")) return sessionResponse({ attachments: true })
    if (url.pathname.endsWith("/threads"))
      return sessionResponse({ items: [], page_after: null, page_before: null })
    if (url.pathname.includes(thread.id))
      return new Promise<Response>((resolve) => {
        resolveFirst = resolve
      })
    return sessionResponse({
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
    })
  })
  const chat = createTestSession({
    threadId: thread.id,
  })
  await vi.waitFor(() => expect(resolveFirst).toBeDefined())
  await chat.openThread(next.id)
  resolveFirst!(Response.json(page()))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(chat.getState().thread?.id).toBe(next.id)
  expect(chat.getState().messages[0]?.id).toBe("second")
  expect(chat.getState().history).toBe("idle")
  expect(chat.getState().error).toBeUndefined()
})

test("a refresh during a first send's conversation creation leaves the session ready", async () => {
  let release: ((response: Response) => void) | undefined
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/threads") && init?.method === "POST")
      return sessionResponse({ ...thread, title: "", version: 0 })
    if (path.endsWith("/messages") && !release)
      return new Promise<Response>((resolve) => {
        release = resolve
      })
    return sessionResponse(page())
  })
  const chat = createTestSession()
  await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
  chat.reset()
  const sent = chat.sendMessage("First message")
  await vi.waitFor(() => expect(release).toBeDefined())
  expect(chat.getState().status).toBe("submitted")
  await chat.refreshThread()
  release!(Response.json(page()))
  await sent
  expect(chat.getState()).toMatchObject({ status: "ready", history: "idle" })
})

test("opening a conversation during a background refresh reports only loading", async () => {
  const next = { ...thread, id: "00000000-0000-4000-8000-000000000003" }
  let reads = 0
  stubSessionFetch((input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (!path.endsWith("/messages"))
      return sessionResponse({ items: [], page_after: null, page_before: null })
    const response = Response.json({
      ...page([
        {
          id: "saved",
          role: "user",
          created_at: thread.created_at,
          parts: [{ id: "text", type: "text", content: "Saved" }],
        },
      ]),
      thread: path.includes(next.id) ? next : thread,
    })
    if (reads++ === 0) return Promise.resolve(response)
    return new Promise<Response>((resolve) => setTimeout(() => resolve(response), 20))
  })
  const chat = createTestSession({ threadId: thread.id })
  await vi.waitFor(() => expect(chat.getState().messages).toHaveLength(1))
  const refresh = chat.refreshThread()
  expect(chat.getState().history).toBe("refreshing")
  const opened = chat.openThread(next.id)
  expect(chat.getState().history).toBe("loading")
  await Promise.all([refresh, opened])
  expect(chat.getState().history).toBe("idle")
})

test("a failed send keeps its Retry after leaving and reopening its conversation", async () => {
  const next = { ...thread, id: "00000000-0000-4000-8000-000000000003" }
  const keys: Array<string | null> = []
  let accepted = false
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/chat")) {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"))
      if (keys.length === 1) return Promise.resolve(new Response("Unavailable", { status: 503 }))
      accepted = true
      return sessionResponse({
        thread_id: thread.id,
        accepted_message_id: "accepted",
        thread_version: 2,
      })
    }
    if (path.endsWith("/messages"))
      return sessionResponse({
        ...page(
          accepted && path.includes(thread.id)
            ? [
                {
                  id: "accepted",
                  role: "user",
                  created_at: thread.created_at,
                  parts: [{ id: "part", type: "text", content: "Keep this" }],
                },
              ]
            : [],
        ),
        thread: path.includes(next.id) ? next : thread,
      })
    return sessionResponse({ items: [], page_after: null, page_before: null })
  })
  const chat = createTestSession({ threadId: thread.id })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  await chat.sendMessage("Keep this")
  const failed = { phase: "failed", content: "Keep this" }
  expect(chat.getState().submission).toMatchObject(failed)
  await chat.openThread(next.id)
  expect(chat.getState()).toMatchObject({ status: "ready", submission: undefined })
  await chat.openThread(thread.id)
  expect(chat.getState().submission).toMatchObject(failed)
  await chat.retry()
  expect(chat.getState().submission?.phase).toBe("accepted")
  expect(chat.getState().messages.filter((message) => message.role === "user")).toHaveLength(1)
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
})

test("failed native hydration blocks sends until a successful reload", async () => {
  let failed = true
  const sends = vi.fn()
  stubSessionFetch((input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/threads"))
      return sessionResponse({ items: [], page_after: null, page_before: null })
    if (path.endsWith("/messages"))
      return failed ? Promise.reject(new TypeError("History unavailable")) : sessionResponse(page())
    sends()
    return Promise.reject(new Error("Generation is not expected"))
  })
  const chat = createTestSession({
    threadId: thread.id,
  })
  await vi.waitFor(() => expect(chat.getState().history).toBe("failed"))
  await chat.sendMessage("Do not send against missing history")
  expect(sends).not.toHaveBeenCalled()
  failed = false
  await chat.openThread(thread.id)
  expect(chat.getState().history).toBe("idle")
  expect(chat.getState().error).toBeUndefined()
})

test("saved threads use their bound agent capabilities and reset uses the configured agent", async () => {
  const agents: Array<string | null> = []
  stubSessionFetch((input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/config")) {
      const agent = url.searchParams.get("agentId")
      agents.push(agent)
      return sessionResponse({ capabilities: { attachments: agent !== "saved-agent" } })
    }
    if (url.pathname.endsWith("/messages"))
      return sessionResponse({ ...page(), thread: { ...thread, agent_id: "saved-agent" } })
    return sessionResponse({ items: [thread], page_after: null })
  })
  const chat = createTestSession({
    threadId: thread.id,
    agentId: "configured-agent",
  })
  await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(false))
  expect(agents.at(-1)).toBe("saved-agent")
  chat.updateOptions({ agentId: "new-default" })
  await vi.waitFor(() => expect(agents.filter((agent) => agent === "saved-agent")).toHaveLength(2))
  chat.reset()
  await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(true))
  expect(agents.at(-1)).toBe("new-default")
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
    stubSessionFetch((input: string | URL) => {
      const path = new URL(input).pathname
      if (path.endsWith("/messages"))
        return sessionResponse(
          {
            status: 404,
            title: "Not found",
            detail: "Conversation not found.",
          },
          { status: 404 },
        )
      if (path.endsWith("/config")) return sessionResponse({ capabilities: { attachments: true } })
      return sessionResponse({ items: [], page_after: null, page_before: null })
    })
    const chat = createTestSession({ threadId })
    await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
    await vi.waitFor(() => expect(chat.getState().history).not.toBe("loading"))
    expect(chat.getState().history === "failed").toBe(threadId !== "auto")
    expect(stored).toBe(threadId === "auto" ? null : thread.id)
    expect(chat.getState().error === undefined).toBe(threadId === "auto")
  },
)

test("a deleted agent disables generation without resolving the default agent", async () => {
  const fallback = vi.fn()
  const send = vi.fn()
  stubSessionFetch((input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/messages"))
      return sessionResponse({ ...page(), thread: { ...thread, agent_id: null } })
    if (path.endsWith("/config")) {
      fallback()
      return sessionResponse({ capabilities: { attachments: true } })
    }
    if (path.endsWith("/chat")) send()
    return sessionResponse({ items: [], page_after: null, page_before: null })
  })
  const chat = createTestSession({
    threadId: thread.id,
    agentId: "configured-agent",
  })
  await vi.waitFor(() => expect(chat.getState().thread?.agentId).toBeNull())
  await vi.waitFor(() => expect(chat.getState().capabilities.attachments).toBe(false))
  const prior = fallback.mock.calls.length
  chat.updateOptions({ agentId: "different-default" })
  const declined = await chat.sendMessage("Must not send")
  expect(fallback).toHaveBeenCalledTimes(prior)
  expect(send).not.toHaveBeenCalled()
  expect(declined.error?.message).toContain("agent is unavailable")
})

test("refresh after membership removal leaves a fresh conversation without an error", async () => {
  let removed = false
  stubSessionFetch((input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/messages") && removed)
      return sessionResponse(
        { status: 404, title: "Not found", detail: "Conversation not found." },
        { status: 404 },
      )
    if (path.endsWith("/messages")) return sessionResponse(page())
    if (path.endsWith("/config")) return sessionResponse({ capabilities: { attachments: true } })
    return sessionResponse({ items: removed ? [] : [thread], page_after: null, page_before: null })
  })
  const chat = createTestSession({
    threadId: thread.id,
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  removed = true
  await chat.refreshThread()
  expect(chat.getState().thread).toBeUndefined()
  expect(chat.getState().error).toBeUndefined()
})

function acceptedStream(id: string, threadId = thread.id) {
  const run = { threadId, runId: `run-${id}` }
  const text = { messageId: `reply-${id}` }
  return new Response(
    [
      { type: "RUN_STARTED", ...run },
      {
        type: "CUSTOM",
        name: "astralbeam_thread",
        value: { threadId, version: 2, acceptedMessageId: `user-${id}` },
      },
      { type: "TEXT_MESSAGE_START", ...text, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", ...text, delta: "Reply" },
      { type: "TEXT_MESSAGE_END", ...text },
      { type: "RUN_FINISHED", ...run },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

test("a send during the refresh after a reply is taken at once and sent when it settles", async () => {
  let sends = 0
  let reads = 0
  let release: (() => void) | undefined
  stubSessionFetch((input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/chat")) return Promise.resolve(acceptedStream(String(++sends)))
    const response = Response.json(page())
    if (++reads !== 2) return Promise.resolve(response)
    return new Promise<Response>((resolve) => {
      release = () => resolve(response)
    })
  })
  const chat = createTestSession({ threadId: thread.id })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  const first = chat.sendMessage("First")
  await vi.waitFor(() => expect(release).toBeDefined())
  expect(chat.getState().history).toBe("refreshing")
  const next = chat.sendMessage("Next")
  expect(chat.getState()).toMatchObject({
    status: "submitted",
    submission: { content: "Next", phase: "submitting" },
  })
  expect(sends).toBe(1)
  release!()
  await Promise.all([first, next])
  expect(sends).toBe(2)
  expect(chat.getState()).toMatchObject({ status: "ready", submission: { phase: "accepted" } })
})

test("a first send stays submitted until its reply streams", async () => {
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/threads") && init?.method === "POST")
      return sessionResponse({ ...thread, title: "", version: 0 })
    if (path.endsWith("/chat")) return Promise.resolve(acceptedStream("1"))
    return sessionResponse(page())
  })
  const chat = createTestSession()
  await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
  const phases: string[] = []
  chat.subscribe(() => {
    const { submission, status } = chat.getState()
    const phase = `${submission?.phase}:${status}`
    if (phases.at(-1) !== phase) phases.push(phase)
  })
  await chat.sendMessage("First message")
  expect(phases).toEqual([
    "submitting:submitted",
    "accepted:submitted",
    "accepted:streaming",
    "accepted:ready",
  ])
})

test.each(["before", "after"] as const)(
  "an attempt declined %s dispatch leaves the active send, its key, and its callbacks",
  async (when) => {
    const keys: Array<string | null> = []
    let release: (() => void) | undefined
    stubSessionFetch((input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname
      if (path.endsWith("/config")) return sessionResponse({ attachments: true })
      if (!path.endsWith("/chat")) return sessionResponse(page())
      keys.push(new Headers(init?.headers).get("Idempotency-Key"))
      return new Promise<Response>((resolve) => {
        release = () => resolve(acceptedStream("1"))
      })
    })
    const chat = createTestSession({ threadId: thread.id })
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    const onAccepted = vi.fn()
    const first = chat.sendMessage("first", { onAccepted })
    if (when === "after") await vi.waitUntil(() => release)
    expect(await chat.sendMessage("second")).toMatchObject({ phase: "refused", content: "second" })
    expect(chat.getState().submission).toMatchObject({ phase: "submitting", content: "first" })
    await vi.waitFor(() => expect(release).toBeDefined())
    release!()
    expect(await first).toMatchObject({ phase: "accepted", content: "first" })
    expect(keys).toHaveLength(1)
    expect(onAccepted).toHaveBeenCalledOnce()
    expect(chat.getState().history).toBe("idle")
  },
)

test("a session restarted like React Strict Mode keeps loading history and sending", async () => {
  let sends = 0
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/threads") && init?.method === "POST")
      return sessionResponse({ ...thread, title: "", version: 0 })
    if (path.endsWith("/chat")) return Promise.resolve(acceptedStream(String(++sends)))
    return sessionResponse(page())
  })
  const chat = createAstralBeamChat({ fetchAstralBeamToken: chatTestToken, threadId: "new" }, true)
  try {
    chat.start()
    chat.dispose()
    chat.start()
    await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
    for (const text of ["first", "second"]) {
      expect(await chat.sendMessage(text)).toMatchObject({ phase: "accepted" })
      expect(chat.getState().history).toBe("idle")
    }
    expect(sends).toBe(2)
  } finally {
    chat.dispose()
  }
})

test("a send before the configured conversation opens returns to its caller", async () => {
  const sends = vi.fn()
  stubSessionFetch((input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/chat") || path.endsWith("/threads")) sends(path)
    return sessionResponse(page())
  })
  const chat = createTestSession({ threadId: thread.id })
  const outcome = await chat.sendMessage("Too early")
  expect(outcome).toMatchObject({ phase: "refused", content: "Too early" })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  expect(sends).not.toHaveBeenCalled()
  expect(chat.getState().submission).toBeUndefined()
})

test.each(["history", "thread"] as const)(
  "Stop returns a send still waiting for its %s without dispatching it",
  async (wait) => {
    const sends = vi.fn()
    let release: (() => void) | undefined
    const hold = (response: Response) =>
      new Promise<Response>((resolve) => {
        release = () => resolve(response)
      })
    let reads = 0
    stubSessionFetch((input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname
      if (path.endsWith("/config")) return sessionResponse({ attachments: true })
      if (path.endsWith("/chat")) {
        sends()
        return Promise.resolve(acceptedStream(String(sends.mock.calls.length)))
      }
      if (path.endsWith("/threads") && init?.method === "POST")
        return hold(Response.json({ ...thread, title: "", version: 0 }))
      const response = Response.json(page())
      return wait === "history" && ++reads === 2 ? hold(response) : Promise.resolve(response)
    })
    const chat = createTestSession(wait === "history" ? { threadId: thread.id } : {})
    await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
    if (wait === "history") {
      await vi.waitUntil(() => chat.getState().thread)
      void chat.refreshThread()
    }
    expect(chat.getState().history).toBe(wait === "history" ? "refreshing" : "idle")
    const outcome = chat.sendMessage("Stop me")
    await vi.waitFor(() => expect(release).toBeDefined())
    chat.stop()
    expect(chat.getState()).toMatchObject({ status: "ready", submission: { phase: "refused" } })
    release!()
    expect(await outcome).toEqual(expect.objectContaining({ phase: "refused", content: "Stop me" }))
    expect((await outcome).error).toBeUndefined()
    expect(sends).not.toHaveBeenCalled()
  },
)

test("an older page adds its messages without replacing the latest thread state", async () => {
  const current = { ...thread, title: "Current title", version: 4 }
  stubSessionFetch((input: string | URL) => {
    const url = new URL(input)
    if (url.pathname.endsWith("/config")) return sessionResponse({ attachments: true })
    const older = url.searchParams.has("page_after")
    const message = (id: string) => ({
      id,
      role: "user",
      created_at: thread.created_at,
      parts: [{ id: "text", type: "text", content: id }],
    })
    return sessionResponse({
      ...page([message(older ? "older" : "latest")]),
      thread: older ? { ...thread, title: "Stale title", version: 1 } : current,
      page_after: older ? null : "earlier",
    })
  })
  const chat = createTestSession({ threadId: thread.id })
  await vi.waitFor(() => expect(chat.getState().thread?.version).toBe(4))
  await chat.loadOlderMessages()
  expect(chat.getState().messages.map((message) => message.id)).toEqual(["older", "latest"])
  expect(chat.getState().thread).toMatchObject({ title: "Current title", version: 4 })
})

test.each(["account", "api", "dispose"] as const)(
  "a send waiting when its %s scope ends is refused and never reaches the next scope",
  async (change) => {
    let user = currentUser
    let holding = false
    const held: Array<() => void> = []
    const posted: unknown[] = []
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname
      if (path.endsWith("/me")) return sessionResponse(user)
      if (path.endsWith("/config")) return sessionResponse({ attachments: true })
      if (path.endsWith("/chat")) {
        if (typeof init?.body !== "string") throw new Error("Expected an AG-UI request body")
        posted.push(
          (JSON.parse(init.body) as { messages: Array<{ content: unknown }> }).messages.at(-1)
            ?.content,
        )
        return Promise.resolve(acceptedStream(String(posted.length)))
      }
      const response = Response.json(page())
      if (!holding) return Promise.resolve(response)
      return new Promise<Response>((resolve) => held.push(() => resolve(response)))
    })
    const chat = createTestSession({ threadId: thread.id })
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    holding = true
    void chat.refreshThread()
    await vi.waitUntil(() => held.length > 0)
    const outcome = chat.sendMessage("Private to the first scope")
    // Lets the send pass its token check and wait on the held history read.
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (change === "account") {
      user = { ...currentUser, user: { id: "another-user" } }
      chat.retryAuthentication()
    } else if (change === "api") chat.updateOptions({ apiUrl: "https://replacement.example/api" })
    else chat.dispose()
    holding = false
    for (const release of held) release()
    expect(await outcome).toMatchObject({ phase: "refused", content: "Private to the first scope" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(JSON.stringify(chat.getState().messages)).not.toContain("Private to the first scope")
    const next =
      change === "dispose"
        ? undefined
        : await vi
            .waitUntil(() => chat.getState().thread && chat.getState().history === "idle")
            .then(() => chat.sendMessage("Next scope"))
    expect(next?.phase).toBe(change === "dispose" ? undefined : "accepted")
    expect(posted).toEqual(change === "dispose" ? [] : ["Next scope"])
  },
)

test("a send after Stop keeps its own conversation when the cancelled creation finishes", async () => {
  const second = { ...thread, id: "00000000-0000-4000-8000-000000000002", title: "" }
  let creations = 0
  let release: (() => void) | undefined
  const targets: string[] = []
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/threads") && init?.method === "POST") {
      if (++creations === 2) return sessionResponse(second)
      return new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ ...thread, title: "", version: 0 }))
      })
    }
    if (path.endsWith("/chat")) {
      if (typeof init?.body !== "string") throw new Error("Expected an AG-UI request body")
      const { threadId } = JSON.parse(init.body) as { threadId: string }
      targets.push(threadId)
      return Promise.resolve(acceptedStream(String(targets.length), threadId))
    }
    const id = path.split("/").at(-2)!
    return sessionResponse({ ...page(), thread: id === second.id ? second : thread })
  })
  const chat = createTestSession()
  await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
  const cancelled = chat.sendMessage("Cancelled")
  await vi.waitUntil(() => release)
  chat.stop()
  expect(await cancelled).toMatchObject({ phase: "refused", content: "Cancelled" })
  expect(await chat.sendMessage("Kept")).toMatchObject({ phase: "accepted" })
  release!()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(chat.getState().thread?.id).toBe(second.id)
  expect(await chat.sendMessage("Next")).toMatchObject({ phase: "accepted" })
  expect(targets).toEqual([second.id, second.id])
})

// Fails the first chat request, then accepts, recording each request's idempotency key.
function stubRetryableChat(onRead?: () => Promise<void> | undefined) {
  const keys: Array<string | null> = []
  stubSessionFetch((input: string | URL, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/chat")) {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"))
      return Promise.resolve(
        keys.length === 1
          ? new Response("Unavailable", { status: 503 })
          : acceptedStream(String(keys.length)),
      )
    }
    if (path.endsWith("/messages"))
      return (onRead?.() ?? Promise.resolve()).then(() => Response.json(page()))
    return sessionResponse({ items: [], page_after: null, page_before: null })
  })
  return keys
}

test("a stale retry attempt cannot act for the newer attempt of the same send", async () => {
  const next = { ...thread, id: "00000000-0000-4000-8000-000000000003" }
  const renewal: { wait?: Promise<void> } = {}
  let release: (() => void) | undefined
  const keys = stubRetryableChat()
  const chat = createTestSession({
    threadId: thread.id,
    fetchAstralBeamToken: async () => {
      await renewal.wait
      return chatTestToken()
    },
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  await chat.sendMessage("Retry me")
  expect(chat.getState().submission?.phase).toBe("failed")
  renewal.wait = new Promise((resolve) => {
    release = resolve
  })
  chat.retryAuthentication()
  const stale = chat.retry()
  void chat.openThread(next.id)
  void chat.openThread(thread.id)
  const fresh = chat.retry()
  release!()
  await Promise.all([stale, fresh])
  await vi.waitFor(() => expect(chat.getState().submission?.phase).toBe("accepted"))
  expect(keys).toEqual([keys[0], keys[0]])
})

test.each(["history", "authentication"] as const)(
  "Stop ends a retry waiting for its %s and keeps the send for a later Retry",
  async (wait) => {
    let hold: Promise<void> | undefined
    let release: (() => void) | undefined
    const keys = stubRetryableChat(() => (wait === "history" ? hold : undefined))
    const chat = createTestSession({
      threadId: thread.id,
      fetchAstralBeamToken: async () => {
        if (wait === "authentication") await hold
        return chatTestToken()
      },
    })
    await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
    await chat.sendMessage("Retry me")
    hold = new Promise((resolve) => {
      release = resolve
    })
    if (wait === "history") void chat.refreshThread()
    else chat.retryAuthentication()
    const stopped = chat.retry()
    chat.stop()
    expect(chat.getState()).toMatchObject({ status: "ready", submission: { phase: "failed" } })
    release!()
    hold = undefined
    expect(await stopped).toMatchObject({ phase: "failed", content: "Retry me" })
    expect(keys).toHaveLength(1)
    expect(await chat.retry()).toMatchObject({ phase: "accepted" })
    expect(keys).toEqual([keys[0], keys[0]])
  },
)

test("a send waiting on token renewal never reaches the account the renewal resolves", async () => {
  let user = currentUser
  const renewal: { wait?: Promise<void> } = {}
  let release: (() => void) | undefined
  const sends = vi.fn()
  vi.stubGlobal("fetch", (input: string | URL) => {
    const path = new URL(input).pathname
    if (path.endsWith("/me")) return sessionResponse(user)
    if (path.endsWith("/config")) return sessionResponse({ attachments: true })
    if (path.endsWith("/chat")) sends()
    return sessionResponse(page())
  })
  const chat = createTestSession({
    threadId: thread.id,
    fetchAstralBeamToken: async () => {
      await renewal.wait
      return chatTestToken()
    },
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  renewal.wait = new Promise((resolve) => {
    release = resolve
  })
  chat.retryAuthentication()
  const outcome = chat.sendMessage("Private to the first account")
  user = { ...currentUser, user: { id: "another-user" } }
  release!()
  expect(await outcome).toMatchObject({ phase: "refused" })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(thread.id))
  expect(JSON.stringify(chat.getState().messages)).not.toContain("Private to the first account")
  expect(sends).not.toHaveBeenCalled()
})
