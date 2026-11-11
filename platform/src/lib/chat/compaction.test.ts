import {
  chat,
  toolDefinition,
  type ChatMiddleware,
  type ModelMessage,
  type AnyTool,
  type TextCompactOptions,
} from "@tanstack/ai"
import { toolSchema } from "@tanstack/ai-effect"
import { fakeText } from "@tanstack/ai/testing"
import { expect, test, vi } from "vitest"
import { Schema } from "effect"
import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import type { MessageRecord } from "./threads/threads"
import { projectChatModelHistory } from "./threads/projection"
import {
  createChatCompactionMiddleware,
  selectChatCompaction,
  type ChatCompactionArtifact,
  type ChatCompactionState,
} from "./compaction-middleware"
import { ChatCompactionError, chatCompactionBoundaries, chatCompactionMessages } from "./compaction"

test("the persistence bridge retains native items and forwards TanStack request options", async () => {
  const output: ModelMessage[] = [
    { role: "user", content: "Retained user input" },
    { role: "assistant", content: "", metadata: { opaque: "signed-state" } },
  ]
  const systemPrompts = [{ content: "Current instructions", metadata: { source: "agent" } }]
  const wrapFetch: TextCompactOptions["wrapFetch"] = (fetch) => fetch
  const fixture = compactionTestSetup([{ onConfig: () => ({ systemPrompts, wrapFetch }) }])
  const compact = vi.fn((_input: TextCompactOptions) => Promise.resolve(output))
  Object.assign(fixture.adapter, { compact })
  await fixture.run(true)
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("a1")
  expect(fixture.requests[0]!.slice(0, 2)).toEqual(output)
  selectChatCompaction(fixture.state, [fixture.state.artifact!], false)
  expect(fixture.state.artifact).toBeUndefined()
  await fixture.run()
  expect(compact).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ systemPrompts, wrapFetch }),
  )
  expect(fixture.state.artifact?.payload.kind).toBe("portable")
})

const compactionTestLimits: ModelConfiguration = {
  currency: "USD",
  pricingSource: { kind: "manual" },
  prices: { inputPerMillion: "1", outputPerMillion: "1" },
  contextTiers: [],
  contextWindowTokens: 3000,
  outputCap: 500,
  maxOutputTokens: 500,
  maxInputTokens: null,
}

function compactionTestPayload(
  ...parts: MessageRecord["payload"]["parts"]
): MessageRecord["payload"] {
  return { version: 1, parts }
}

function compactionTestHistory(): MessageRecord[] {
  return [
    ["u1", "user", "a".repeat(2000), null],
    ["a1", "assistant", "b".repeat(2000), "u1"],
    ["u2", "user", "c".repeat(2000), null],
    ["a2", "assistant", "d".repeat(2000), "u2"],
    ["u3", "user", "Continue", null],
  ].map(([id, role, content, turnMessageId]) => ({
    id,
    role,
    state: "complete",
    turnMessageId,
    responseTargetId: null,
    payload: { version: 1, parts: [{ id: `${id}-part`, type: "text", content }] },
  })) as unknown as MessageRecord[]
}

function compactionTestSetup(middleware: ChatMiddleware[] = []) {
  const state = {
    history: compactionTestHistory(),
    compatibilityKey: "provider-config",
    claim: { threadId: "thread" },
  } as ChatCompactionState
  const requests: ModelMessage[][] = []
  const adapter = fakeText({ model: "test-model" })
  adapter.setResponses(
    [0, 1].map(() => ({ request }) => {
      requests.push(request.messages)
      return { text: "Continued." }
    }),
  )
  const summaryAdapter = fakeText()
  summaryAdapter.setResponses([{ text: "Goals and completed work. AB-428 is still pending." }])
  const save = vi.fn((anchor: string, payload: ChatCompactionArtifact["payload"]) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      coveredThroughMessageId: anchor,
      payload,
      compatibilityKey: state.compatibilityKey,
    } as ChatCompactionArtifact),
  )
  const suffix = () => {
    const index = state.history.findIndex(
      (message) => message.id === state.artifact?.coveredThroughMessageId,
    )
    return projectChatModelHistory(state.history.slice(index + 1))
  }
  const metrics = vi.fn(async (_metrics: Schema.JsonObject) => {})
  const beforeCall = vi.fn(async () => {})
  const compaction = (native = false) =>
    createChatCompactionMiddleware({
      state,
      adapter,
      summaryAdapter,
      native,
      configuration: compactionTestLimits,
      summaryOptions: {},
      onUsage: async () => {},
      onMetrics: metrics,
      beforeCall,
      save,
      projectSuffix: () => Promise.resolve(suffix()),
    })
  const projection: ChatMiddleware = {
    name: "canonical-projection",
    onConfig: () => ({
      providerMessages: [
        ...(state.artifact ? chatCompactionMessages(state.artifact.payload) : []),
        ...suffix(),
      ],
    }),
  }
  const run = (native = false, abortController?: AbortController, tools: AnyTool[] = []) =>
    chat({
      adapter,
      messages: projectChatModelHistory(state.history),
      threadId: "thread",
      stream: false,
      debug: false,
      tools,
      middleware: [projection, ...middleware, compaction(native)],
      ...(abortController ? { abortController } : {}),
    })
  return {
    state,
    adapter,
    summaryAdapter,
    save,
    requests,
    run,
    compaction,
    projection,
    metrics,
    beforeCall,
  }
}

test.each([false, true])(
  "failed summarization continues only when original context fits: %s",
  async (oversized) => {
    const fixture = compactionTestSetup()
    if (oversized)
      fixture.state.history[0]!.payload = compactionTestPayload({
        id: "u1-part",
        type: "text",
        content: "x".repeat(6000),
      })
    fixture.summaryAdapter.setResponses([{ error: "Unavailable" }])
    const outcome = await fixture.run().then(
      (reply) => reply.text,
      (error: unknown) => (error instanceof ChatCompactionError ? error.code : error),
    )
    expect(outcome).toBe(oversized ? "compaction_context_full" : "Continued.")
    expect(fixture.adapter.state.callCount).toBe(oversized ? 0 : 1)
    expect(fixture.save).not.toHaveBeenCalled()
  },
)

test("recoverable compaction does not swallow publication or authority failures", async () => {
  const fixture = compactionTestSetup()
  fixture.save.mockRejectedValueOnce(new Error("Publication failed"))
  await expect(fixture.run()).rejects.toThrow("Publication failed")
  expect(fixture.adapter.state.callCount).toBe(0)
  fixture.beforeCall.mockRejectedValue(new Error("Access revoked"))
  await expect(fixture.run()).rejects.toThrow("Access revoked")
  expect(fixture.adapter.state.callCount).toBe(0)
})

test("usage follows the exact provider prefix and portable cuts summarize every covered message", async () => {
  const fixture = compactionTestSetup()
  for (const [index, size] of [3000, 3000, 800, 800].entries())
    fixture.state.history[index]!.payload = compactionTestPayload({
      id: `part-${index}`,
      type: "text",
      content: String(index).repeat(size),
    })
  const compaction = fixture.compaction()
  const onUsage = compaction.onUsage!
  compaction.onUsage = (ctx, usage) => onUsage(ctx, { ...usage, promptTokens: 1000 })
  const run = () =>
    chat({
      adapter: fixture.adapter,
      messages: projectChatModelHistory(fixture.state.history),
      threadId: "thread",
      stream: false,
      debug: false,
      middleware: [fixture.projection, compaction],
    })
  await run()
  expect(fixture.save).not.toHaveBeenCalled()
  fixture.state.history.push(
    {
      ...fixture.state.history[1]!,
      id: "a3",
      turnMessageId: "u3",
      payload: compactionTestPayload({ id: "a3-part", type: "text", content: "new".repeat(2100) }),
    },
    {
      ...fixture.state.history[0]!,
      id: "u4",
      payload: compactionTestPayload({ id: "u4-part", type: "text", content: "Continue" }),
    },
  )
  const summaries: string[] = []
  fixture.summaryAdapter.setResponses([
    ({ request }) => {
      summaries.push(JSON.stringify(request.messages))
      return { text: "Covered work" }
    },
  ])
  await run()
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("a1")
  expect(summaries[0]).toContain("0".repeat(3000))
  expect(summaries[0]).toContain("1".repeat(3000))
  expect(fixture.metrics).toHaveBeenCalledWith(expect.objectContaining({ actualInputTokens: 1000 }))
})

test.each([
  { sizes: [3300, 3300, 2000], covered: "a1", fits: true },
  { sizes: [8500], covered: undefined, fits: true },
  { sizes: [11000], covered: undefined, fits: false },
])(
  "large input capacity, settled prefix: $covered, fits: $fits",
  async ({ sizes, covered, fits }) => {
    const fixture = compactionTestSetup()
    fixture.state.history = fixture.state.history.slice(0, sizes.length)
    for (const [index, size] of sizes.entries()) {
      fixture.state.history[index]!.payload = compactionTestPayload({
        id: `text-${index}`,
        type: "text",
        content: "x".repeat(size),
      })
    }
    const result = await fixture.run().then(
      (reply) => reply.text,
      (error: unknown) => (error instanceof ChatCompactionError ? error.code : error),
    )
    expect(result).toBe(fits ? "Continued." : "compaction_context_full")
    expect(fixture.summaryAdapter.state.callCount).toBe(covered ? 1 : 0)
    expect(fixture.state.artifact?.coveredThroughMessageId).toBe(covered)
  },
)

test("compaction persists across model phases and reloads without repeating committed tools", async () => {
  const fixture = compactionTestSetup()
  fixture.adapter.setResponses([
    { toolCalls: [{ id: "call-1", name: "lookup", input: {} }] },
    { toolCalls: [{ id: "call-2", name: "lookup", input: {} }] },
    { text: "Finished." },
  ])
  fixture.summaryAdapter.appendResponses([{ text: "Updated" }, { text: "Updated again" }])
  let effects = 0
  const lookup = toolDefinition({
    name: "lookup",
    description: "Read a result",
    inputSchema: toolSchema(Schema.Struct({})),
  }).server(() => {
    effects += 1
    const id = `decision-${effects}`
    const part = `part-${effects}`
    const slot = `slot-${effects}`
    const output = "result".repeat(700)
    fixture.state.history.push(
      {
        ...fixture.state.history[1]!,
        id,
        turnMessageId: "u3",
        payload: compactionTestPayload({
          id: part,
          type: "tool-call",
          toolCallId: `call-${effects}`,
          name: "lookup",
          arguments: "{}",
          targets: [{ id: slot }],
        }),
      },
      {
        ...fixture.state.history[1]!,
        id: `result-${effects}`,
        role: "tool",
        turnMessageId: "u3",
        sourceAssistantMessageId: id,
        sourceToolPartId: part,
        responseTargetId: slot,
        payload: compactionTestPayload({
          id: `output-${effects}`,
          type: "tool-result",
          toolCallId: `call-${effects}`,
          outcome: "succeeded",
          output,
        }),
      },
    )
    return output
  })
  expect((await fixture.run(false, undefined, [lookup])).text).toBe("Finished.")
  expect(effects).toBe(2)
  expect(fixture.adapter.state.callCount).toBe(3)
  expect(fixture.save).toHaveBeenCalledTimes(3)
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("result-1")
  expect(fixture.state.history.filter((message) => message.role === "tool")).toHaveLength(2)
  const artifact = fixture.state.artifact!
  const original = structuredClone(fixture.state.history)
  fixture.state.artifact = undefined
  selectChatCompaction(
    fixture.state,
    [
      { ...artifact, coveredThroughMessageId: "sibling" },
      {
        ...artifact,
        coveredThroughMessageId: "result-2",
        compatibilityKey: "other",
        payload: { ...artifact.payload, kind: "native" },
      },
      artifact,
    ],
    true,
  )
  fixture.adapter.appendResponses([{ text: "Reopened." }])
  expect((await fixture.run()).text).toBe("Reopened.")
  expect(fixture.summaryAdapter.state.callCount).toBe(3)
  expect(fixture.save).toHaveBeenCalledTimes(3)
  expect(effects).toBe(2)
  expect(fixture.state.history).toEqual(original)
})

test.each([false, true])(
  "disconnect cancellation stops a summary before publication or inference, native: %s",
  async (native) => {
    const fixture = compactionTestSetup()
    const started = Promise.withResolvers<void>()
    const waitForAbort = (signal: AbortSignal | undefined | null) =>
      new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true })
        started.resolve()
      })
    if (native)
      Object.assign(fixture.adapter, {
        compact: ({ signal }: TextCompactOptions) => waitForAbort(signal),
      })
    else
      fixture.summaryAdapter.setResponses([({ request }) => waitForAbort(request.request?.signal)])
    const controller = new AbortController()
    const running = fixture.run(native, controller)
    await started.promise
    controller.abort()
    await running.catch(() => undefined)
    expect(fixture.save).not.toHaveBeenCalled()
    expect(fixture.adapter.state.callCount).toBe(0)
  },
)

test("compaction advances past terminal interrupted replies without replaying draft tool calls", async () => {
  const fixture = compactionTestSetup()
  fixture.state.history[0]!.payload = compactionTestPayload({
    id: "u1-part",
    type: "text",
    content: "input".repeat(1000),
  })
  fixture.state.history[1]!.state = "interrupted"
  fixture.state.history[1]!.payload = compactionTestPayload({
    id: "uncommitted-call",
    type: "tool-call",
    name: "update",
    arguments: "{}",
    toolCallId: "never-executed",
    targets: [{ id: "uncommitted-slot" }],
  })
  expect(chatCompactionBoundaries(fixture.state.history)).toEqual([1, 3])
  await fixture.run()
  expect(fixture.save).toHaveBeenCalledOnce()
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("a1")
  expect(JSON.stringify(fixture.requests)).not.toContain("never-executed")
  expect(fixture.state.history[1]!.state).toBe("interrupted")
  fixture.state.history[1]!.state = "draft"
  expect(chatCompactionBoundaries(fixture.state.history)).toEqual([])
  fixture.state.history[1]!.state = "complete"
  expect(chatCompactionBoundaries(fixture.state.history)).toEqual([])
})
