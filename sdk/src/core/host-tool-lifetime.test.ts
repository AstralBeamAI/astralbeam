import { afterEach, expect, test, vi } from "vitest"
import { createTestSession, disposeTestSessions } from "./session-fixtures.ts"

const id = "00000000-0000-4000-8000-000000000001"
const thread = {
  id,
  title: "Dummy thread",
  agent_id: "dummy-agent",
  version: 1,
  role: "manager",
  writer_active: false,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
}
const userA = {
  scope: "tenant",
  organization: { id: "dummy-org" },
  tenant: { id: "dummy-tenant-A" },
  user: { id: "dummy-A" },
}
const userB = {
  ...userA,
  tenant: { id: "dummy-tenant-B" },
  user: { id: "dummy-B" },
}
const events = (chunks: unknown[]) =>
  new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  })

afterEach(() => {
  disposeTestSessions()
  vi.unstubAllGlobals()
})

test.each([
  { mode: "unchanged", expected: "dummy-A" },
  { mode: "dispose-remount", expected: undefined },
  { mode: "verified-identity", expected: undefined },
  { mode: "selection-reset", expected: undefined },
  { mode: "stop", expected: undefined },
  { mode: "removed-tool", expected: undefined },
  { mode: "changed-schema", expected: undefined },
  { mode: "current-callback", expected: "updated" },
  { mode: "reject-validation", expected: undefined },
])("host execution after pending validation: $mode", async ({ mode, expected }) => {
  let current = userA
  let validationStarted = 0
  let callbackStarted = 0
  let release!: (result: unknown) => void
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const mutations: { authority: string; tenant: string; requestedBy: string; input: unknown }[] = []
  const requests: { path: string; authority: string }[] = []
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "dummy-delayed-validator",
      validate(input: unknown) {
        validationStarted++
        return pending.then((result) => result ?? { value: input })
      },
    },
  }
  const name = "mark_dummy"
  const input = { marker: "A-request" }
  const args = JSON.stringify(input)
  const assistant = {
    id: "assistant",
    role: "assistant",
    created_at: thread.created_at,
    parts: [
      {
        id: "application-part",
        type: "tool-call",
        toolCallId: "provider-call",
        name,
        arguments: args,
        input,
        state: "input-complete",
      },
    ],
  }
  let phase = "empty"
  let clientId = ""
  vi.stubGlobal("sessionStorage", undefined)
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) =>
    Promise.resolve().then(() => {
      const path = new URL(url).pathname
      requests.push({ path, authority: current.user.id })
      if (path.endsWith("/me")) return Response.json(current)
      if (path.endsWith("/chat/config"))
        return Response.json({ capabilities: { attachments: true } })
      if (path.endsWith("/messages"))
        return Response.json({
          thread,
          messages: phase === "empty" ? [] : [assistant],
          pending_interactions:
            phase === "decision"
              ? [
                  {
                    source_message_id: "assistant",
                    source_part_id: "application-part",
                    response_target_id: "target",
                    tool_call_id: "provider-call",
                    target_tenant_user_id: userA.user.id,
                    target_client_id: clientId,
                    execution_location: "browser",
                  },
                ]
              : [],
          page_after: null,
          page_before: null,
        })
      if (path.endsWith("/tool-results")) {
        phase = "resolved"
        return events([
          { type: "RUN_STARTED", threadId: id, runId: "continued" },
          {
            type: "RUN_FINISHED",
            threadId: id,
            runId: "continued",
            metadata: { tanstack: { finishReason: "stop" } },
          },
        ])
      }
      if (path.endsWith("/chat")) {
        if (current.user.id !== userA.user.id)
          throw new Error("Old tool started a new session request")
        if (typeof init?.body !== "string") throw new Error("Expected a chat body")
        const body = JSON.parse(init.body) as { forwardedProps: { clientId: string } }
        clientId = body.forwardedProps.clientId
        phase = "decision"
        return events([
          { type: "RUN_STARTED", threadId: id, runId: "initial" },
          {
            type: "CUSTOM",
            name: "astralbeam_thread",
            value: {
              threadId: id,
              version: 2,
              acceptedMessageId: "input",
              saved: true,
              executableToolCallIds: ["provider-call"],
            },
          },
          {
            type: "TOOL_CALL_START",
            toolCallId: "provider-call",
            toolCallName: name,
            parentMessageId: "assistant",
          },
          { type: "TOOL_CALL_ARGS", toolCallId: "provider-call", delta: args },
          { type: "TOOL_CALL_END", toolCallId: "provider-call" },
          {
            type: "RUN_FINISHED",
            threadId: id,
            runId: "initial",
            metadata: { tanstack: { finishReason: "tool_calls" } },
            outcome: {
              type: "interrupt",
              interrupts: [
                {
                  id: "client_tool_provider-call",
                  reason: "tanstack:client_tool_execution",
                  toolCallId: "provider-call",
                  metadata: { kind: "client_tool", toolName: name, input },
                },
              ],
            },
          },
        ])
      }
      throw new Error(`Unexpected in-memory request ${path}`)
    }),
  )
  const execute = (validated: unknown) => {
    callbackStarted++
    mutations.push({
      authority: current.user.id,
      tenant: current.tenant.id,
      requestedBy: userA.user.id,
      input: validated,
    })
    return { marked: true }
  }
  const chat = createTestSession({
    apiUrl: "https://dummy.invalid/api",
    threadId: id,
    tools: { mark_dummy: { description: "Record one dummy marker", parameters: schema, execute } },
  })
  await vi.waitFor(() => expect(chat.getState().thread?.id).toBe(id))
  const sending = chat.sendMessage("A requests one dummy marker")
  await vi.waitFor(() => expect(validationStarted).toBe(1))
  expect(callbackStarted).toBe(0)
  if (mode === "dispose-remount") {
    current = userB
    chat.dispose()
    const replacement = createTestSession({
      apiUrl: "https://dummy.invalid/api",
      threadId: "new",
    })
    await vi.waitUntil(() => replacement.getState().auth.status === "ready")
  } else if (mode === "verified-identity") {
    current = userB
    chat.retryAuthentication()
    await vi.waitUntil(() => {
      const auth = chat.getState().auth
      return auth.status === "ready" && auth.currentUser.user.id === userB.user.id
    })
  } else if (mode === "selection-reset") chat.reset()
  else if (mode === "stop") chat.stop()
  else if (mode === "removed-tool") chat.updateOptions({ tools: {} })
  else if (mode === "changed-schema" || mode === "current-callback")
    chat.updateOptions({
      tools: {
        mark_dummy: {
          description: "Updated marker",
          parameters: mode === "changed-schema" ? { ...schema } : schema,
          execute: (input) => {
            callbackStarted++
            mutations.push({
              authority: "updated",
              tenant: current.tenant.id,
              requestedBy: userA.user.id,
              input,
            })
            return { marked: true }
          },
        },
      },
    })
  expect(callbackStarted).toBe(0)
  release(
    mode === "reject-validation" ? { issues: [{ message: "Rejected dummy input" }] } : undefined,
  )
  await sending
  expect(callbackStarted).toBe(expected ? 1 : 0)
  expect(mutations.map((x) => x.authority)).toEqual(expected ? [expected] : [])
  expect(requests.filter((x) => x.path.endsWith("/chat"))).toHaveLength(1)
  expect(
    requests.filter((x) => x.path.endsWith("/chat") && x.authority === userB.user.id),
  ).toHaveLength(0)
})
