import {
  chat,
  toolDefinition,
  type ChatMiddleware,
  type ModelMessage,
  type AnyTool,
  type AnyTextAdapter,
} from "@tanstack/ai"
import { fakeText } from "@tanstack/ai/testing"
import { resolveDebugOption } from "@tanstack/ai/adapter-internals"
import { expect, test, vi } from "vitest"
import { Schema } from "effect"
import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import type { MessageRecord } from "./threads/threads"
import { projectChatModelHistory } from "./threads/projection"
import {
  createChatCompactionMiddleware,
  estimateChatContext,
  selectChatCompaction,
  type ChatCompactionArtifact,
  type ChatCompactionState,
} from "./compaction-middleware"
import { chatToolInputSchema } from "./tool-schema"
import { chatCompactionBoundaries, chatCompactionMessages } from "./compaction"
import { createChatAdapter } from "./adapter"
import { chatCompactionOutputOptions, fetchChatCompactionUsage } from "./compaction-middleware"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

const compactionTestModel: ChatModelConfiguration = {
  providerId: "provider",
  providerName: "OpenAI",
  providerType: "openai",
  api: "responses",
  modelId: "gpt-6.1-sol",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "synthetic",
  fetch,
}

test("the installed OpenAI adapter round-trips the complete native window and reports compaction usage", async () => {
  const output = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Retained user input" }],
    },
    { type: "compaction", id: "cmp_1", encrypted_content: "synthetic-opaque-state" },
  ]
  const record = vi.fn(() => Promise.resolve())
  const requests: Record<string, unknown>[] = []
  const model = {
    ...compactionTestModel,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push((await request.json()) as Record<string, unknown>)
      return request.url.endsWith("/compact")
        ? Response.json({
            output,
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 10 },
            },
          })
        : Response.json({ error: { message: "Synthetic inference boundary" } }, { status: 400 })
    },
  }
  const adapter: AnyTextAdapter = createChatAdapter({
    ...model,
    fetch: (input, init) => fetchChatCompactionUsage({ model, input, init, record }),
  })
  const fixture = compactionTestSetup()
  Object.assign(fixture.adapter, { compact: adapter.compact!.bind(adapter) })
  await fixture.run(true)
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("a1")
  expect(fixture.state.artifact?.payload.messages).toHaveLength(2)
  const messages = fixture.requests[0]!
  for await (const _chunk of adapter.chatStream({
    threadId: "thread",
    model: model.modelId,
    messages,
    systemPrompts: [],
    tools: [],
    logger: resolveDebugOption(false),
    modelOptions: chatCompactionOutputOptions(model, 32),
  })) {
    /* Consume the synthetic provider error. */
  }
  expect((requests[1]!.input as unknown[]).slice(0, 2)).toEqual(output)
  expect(requests[1]?.max_output_tokens).toBe(32)
  expect(record).toHaveBeenCalledExactlyOnceWith({
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    promptTokensDetails: { cachedTokens: 10 },
  })
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

function compactionTestSetup() {
  const state = {
    history: compactionTestHistory(),
    compatibilityKey: "provider-config",
    claim: { threadId: "thread" },
  } as ChatCompactionState
  const requests: ModelMessage[][] = []
  const adapter = fakeText({ model: compactionTestModel.modelId })
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
  const middleware = (native = false) =>
    createChatCompactionMiddleware({
      state,
      adapter,
      summaryAdapter,
      modelId: adapter.model,
      native,
      configuration: compactionTestLimits,
      summaryOptions: {},
      summaryMiddleware: [],
      beforeCall: async () => {},
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
      middleware: [projection, middleware(native)],
      ...(abortController ? { abortController } : {}),
    })
  return { state, adapter, summaryAdapter, save, requests, run }
}

test("compaction persists across model phases and reloads without repeating committed tools", async () => {
  const fixture = compactionTestSetup()
  fixture.adapter.setResponses([
    { toolCalls: [{ id: "call-1", name: "lookup", input: {} }] },
    { toolCalls: [{ id: "call-2", name: "lookup", input: {} }] },
    { text: "Finished." },
  ])
  fixture.summaryAdapter.appendResponses([
    { text: "Updated checkpoint." },
    { text: "Updated tool checkpoint." },
  ])
  let effects = 0
  const lookup = toolDefinition({
    name: "lookup",
    description: "Read a result",
    inputSchema: chatToolInputSchema(Schema.Struct({})),
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
        payload: {
          version: 1,
          parts: [
            {
              id: part,
              type: "tool-call",
              toolCallId: `call-${effects}`,
              name: "lookup",
              arguments: "{}",
              targets: [{ id: slot }],
            },
          ],
        },
      },
      {
        ...fixture.state.history[1]!,
        id: `result-${effects}`,
        role: "tool",
        turnMessageId: "u3",
        sourceAssistantMessageId: id,
        sourceToolPartId: part,
        responseTargetId: slot,
        payload: {
          version: 1,
          parts: [
            {
              id: `output-${effects}`,
              type: "tool-result",
              toolCallId: `call-${effects}`,
              outcome: "succeeded",
              output,
            },
          ],
        },
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
  selectChatCompaction(fixture.state, [
    { ...artifact, coveredThroughMessageId: "sibling" },
    {
      ...artifact,
      coveredThroughMessageId: "result-2",
      compatibilityKey: "other",
      payload: { ...artifact.payload, kind: "native" },
    },
    artifact,
  ])
  fixture.adapter.appendResponses([{ text: "Reopened." }])
  expect((await fixture.run()).text).toBe("Reopened.")
  expect(fixture.summaryAdapter.state.callCount).toBe(3)
  expect(fixture.save).toHaveBeenCalledTimes(3)
  expect(effects).toBe(2)
  expect(fixture.state.history).toEqual(original)
})

test("disconnect cancellation stops a summary before publication or inference", async () => {
  const fixture = compactionTestSetup()
  const started = Promise.withResolvers<void>()
  fixture.summaryAdapter.setResponses([
    ({ request }) =>
      new Promise((_resolve, reject) => {
        request.request?.signal?.addEventListener("abort", () => reject(new Error("Cancelled")), {
          once: true,
        })
        started.resolve()
      }),
  ])
  const controller = new AbortController()
  const running = fixture.run(false, controller)
  await started.promise
  controller.abort()
  await running.catch(() => undefined)
  expect(fixture.save).not.toHaveBeenCalled()
  expect(fixture.adapter.state.callCount).toBe(0)
})

test("compaction advances past terminal interrupted replies without replaying draft tool calls", async () => {
  const fixture = compactionTestSetup()
  fixture.state.history[0]!.payload = {
    version: 1,
    parts: [{ id: "u1-part", type: "text", content: "input".repeat(1000) }],
  }
  fixture.state.history[1]!.state = "interrupted"
  fixture.state.history[1]!.payload = {
    version: 1,
    parts: [
      {
        id: "uncommitted-call",
        type: "tool-call",
        name: "update",
        arguments: "{}",
        toolCallId: "never-executed",
        targets: [{ id: "uncommitted-slot" }],
      },
    ],
  }
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

test("media budgets count images independently of base64 length", () => {
  const message = (size: number): ModelMessage => ({
    role: "user",
    content: [
      { type: "image", source: { type: "data", mimeType: "image/png", value: "a".repeat(size) } },
    ],
  })
  expect(estimateChatContext(message(2_000_000))).toBe(estimateChatContext(message(4)))
  expect(estimateChatContext(message(2_000_000))).toBeGreaterThan(4000)
})
