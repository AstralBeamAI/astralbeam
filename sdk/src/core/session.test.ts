import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ASK_QUESTIONNAIRE_TOOL } from "./protocol.ts"
import {
  type AstralBeamChatCoreOptions,
  CORE_OPTION_KEYS,
  createAstralBeamChat,
} from "./session.ts"

// The token cache only reads `exp` out of the payload; nothing here verifies a signature.
function chatAuthToken(): { token: string } {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 300 }))
  return { token: `header.${payload}.signature` }
}

beforeEach(() => {
  // No test should reach the network; the capability handshake fails closed on this.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("the network is unavailable in tests")))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// The React wrapper watches these keys to re-apply option changes, so one missing from the list is
// an option that silently keeps its mount-time value (`streamCallbacks` was, once).
test("the watched option list covers every option the session reads per request", () => {
  const everyOption: Required<AstralBeamChatCoreOptions> = {
    agentId: "agt_acme_todos",
    apiUrl: "https://example.test/api",
    fetchChatAuthToken: chatAuthToken,
    tools: {},
    widgets: {},
    onRenderWidget: () => undefined,
    streamCallbacks: {},
    debug: false,
  }

  expect([...CORE_OPTION_KEYS].sort()).toEqual(Object.keys(everyOption).sort())
})

// A React host rebuilds its tool objects every render, so publishing a fresh `agentTools` for an
// unchanged tool set would notify a subscriber whose rerender feeds the same update back in.
test("rebuilding equivalent tool definitions notifies no subscriber", () => {
  const tools = () => ({
    refresh: {
      description: "Refresh the host's list",
      metadata: { title: "Refresh the list" },
      execute: () => "done",
    },
  })
  const chat = createAstralBeamChat({ fetchChatAuthToken: chatAuthToken, tools: tools() })
  let notifications = 0
  chat.subscribe(() => {
    notifications += 1
  })

  chat.updateOptions({ tools: tools() })
  chat.updateOptions({ tools: tools() })

  expect(notifications).toBe(0)
  expect(chat.getState().agentTools).toEqual([
    { name: ASK_QUESTIONNAIRE_TOOL, title: undefined },
    { name: "refresh", title: "Refresh the list" },
  ])

  // A real change still reaches the store, so a title update relabels its transcript entry.
  chat.updateOptions({
    tools: { refresh: { description: "Refresh the host's list", execute: () => "done" } },
  })

  expect(notifications).toBe(1)
  expect(chat.getState().agentTools).toEqual([
    { name: ASK_QUESTIONNAIRE_TOOL, title: undefined },
    { name: "refresh", title: undefined },
  ])
  chat.dispose()
})

// The handshake runs again per agent and API base, and the responses can land out of order; the
// attachment grant the composer reads must be the current agent's.
test("a capability response for a superseded agent does not overwrite the current grant", async () => {
  const requests: Array<{ url: string; answer: (attachments: boolean) => void }> = []
  vi.stubGlobal("fetch", (input: URL) =>
    new Promise<Response>((resolve) => {
      requests.push({
        url: String(input),
        answer: (attachments) =>
          resolve(new Response(JSON.stringify({ capabilities: { attachments } }))),
      })
    }))
  const chat = createAstralBeamChat({
    agentId: "agt_acme_first",
    fetchChatAuthToken: chatAuthToken,
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
