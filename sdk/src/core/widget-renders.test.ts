import { expect, test, vi } from "vitest"

import { RENDER_WIDGET_TOOL } from "./protocol.ts"
import { createAstralBeamChat } from "./session.ts"

interface ClientTool {
  name: string
  execute?: (input: unknown, context: { toolCallId: string }) => Promise<unknown>
}

const mocked = vi.hoisted(() => ({ tools: [] as ClientTool[] }))

// A widget render is only reachable through the tool set the session hands its chat client, so the
// client is replaced by the smallest stub that records those options.
vi.mock("@tanstack/ai-client", () => ({
  ChatClient: class {
    constructor(options: { tools: ClientTool[] }) {
      mocked.tools = options.tools
    }
    updateOptions(options: { tools: ClientTool[] }) {
      mocked.tools = options.tools
    }
    getError() {
      return undefined
    }
    clear() {}
    stop() {}
    dispose() {}
  },
  fetchServerSentEvents: () => ({}),
}))

function chatAuthToken(): { token: string } {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 300 }))
  return { token: `header.${payload}.signature` }
}

// The chat widget caps its live renders and disposes the oldest itself. The session keeps a cleanup
// per tool call, which captures that render, so an evicted one has to leave nothing behind.
test("a released render leaves no cleanup behind in the session", async () => {
  const cleanupsRun: string[] = []
  const releases = new Map<string, () => void>()
  const chat = createAstralBeamChat({
    fetchChatAuthToken: chatAuthToken,
    widgets: { card: { description: "A host card" } },
    onRenderWidget: ({ toolCallId, release }) => {
      releases.set(toolCallId, release)
      return () => cleanupsRun.push(toolCallId)
    },
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
    fetchChatAuthToken: chatAuthToken,
    widgets: { card: { description: "A host card" } },
    onRenderWidget: ({ toolCallId, release }) => {
      releases.push(release)
      return () => cleanupsRun.push(toolCallId)
    },
  })
  const renderWidget = mocked.tools.find((tool) => tool.name === RENDER_WIDGET_TOOL)
  await renderWidget?.execute?.({ widget: "card", props: {} }, { toolCallId: "call-1" })
  await renderWidget?.execute?.({ widget: "card", props: {} }, { toolCallId: "call-1" })

  releases[0]?.()
  chat.reset()

  expect(cleanupsRun).toEqual(["call-1", "call-1"])

  chat.dispose()
})
