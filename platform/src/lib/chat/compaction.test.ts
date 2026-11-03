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
  const messages = await adapter.compact!({
    messages: [{ role: "user", content: "History" }],
    model: model.modelId,
  })
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
  expect(requests[1]?.input).toEqual(output)
  expect(requests[1]?.max_output_tokens).toBe(32)
  expect(record).toHaveBeenCalledExactlyOnceWith({
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    promptTokensDetails: { cachedTokens: 10 },
  })
})

test("OpenAI Chat Completions receives max_completion_tokens rather than max_tokens", async () => {
  let body: Record<string, unknown> | undefined
  const model = {
    ...compactionTestModel,
    api: "chat-completions" as const,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      body = (await new Request(input, init).json()) as Record<string, unknown>
      return Response.json({ error: { message: "Synthetic boundary" } }, { status: 400 })
    },
  }
  for await (const _chunk of createChatAdapter(model).chatStream({
    threadId: "thread",
    model: model.modelId,
    messages: [{ role: "user", content: "Hello" }],
    systemPrompts: [],
    tools: [],
    logger: resolveDebugOption(false),
    modelOptions: chatCompactionOutputOptions(model, 32),
  })) {
    /* Consume the synthetic provider error. */
  }
  expect(body?.max_completion_tokens).toBe(32)
  expect(body).not.toHaveProperty("max_tokens")
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

function compactionTestSetup(configuration = compactionTestLimits) {
  const state = {
    history: compactionTestHistory(),
    compatibilityKey: "provider-config",
    claim: { threadId: "thread" },
  } as ChatCompactionState
  const requests: ModelMessage[][] = []
  const adapter = fakeText()
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
      native,
      modelId: adapter.model,
      configuration,
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

test("the library bridge saves an ancestral summary and reuses it after reload without hiding history", async () => {
  const fixture = compactionTestSetup()
  const original = structuredClone(fixture.state.history)
  expect((await fixture.run()).text).toBe("Continued.")
  expect(fixture.save).toHaveBeenCalledOnce()
  const artifact = fixture.state.artifact!
  expect(artifact.coveredThroughMessageId).toBe("a1")
  expect(artifact.payload.kind).toBe("portable")
  expect(fixture.requests[0]![0]!.content).toContain("AB-428")
  expect(fixture.requests[0]).toHaveLength(4)
  expect(fixture.state.history).toEqual(original)
  fixture.state.artifact = undefined
  selectChatCompaction(fixture.state, [artifact])
  expect((await fixture.run()).text).toBe("Continued.")
  expect(fixture.summaryAdapter.state.callCount).toBe(1)
  expect(fixture.save).toHaveBeenCalledOnce()
})

test("native compaction receives only the settled prefix and keeps every returned item", async () => {
  const fixture = compactionTestSetup()
  const compact = vi.fn((input: { messages: ModelMessage[] }) => {
    expect(input.messages.map((message) => message.id?.split(":")[0])).toEqual(["u1", "a1"])
    return Promise.resolve([
      { role: "user" as const, content: "retained native item" },
      {
        role: "assistant" as const,
        content: "opaque native state",
        metadata: { provider: "opaque" },
      },
    ])
  })
  Object.assign(fixture.adapter, { compact })
  await fixture.run(true)
  expect(compact).toHaveBeenCalledOnce()
  expect(fixture.state.artifact!.payload.messages).toHaveLength(2)
  expect(fixture.requests[0]![1]!.metadata).toEqual({ provider: "opaque" })
  expect(fixture.summaryAdapter.state.callCount).toBe(0)
})

test.each([
  { text: "", finishReason: "stop" as const },
  { text: "Truncated summary", finishReason: "length" as const },
  { text: "Inflated summary".repeat(1000), finishReason: "stop" as const },
])("an unusable summary fails before inference or publication: $finishReason", async (response) => {
  const fixture = compactionTestSetup()
  fixture.summaryAdapter.setResponses([response])
  await expect(fixture.run()).rejects.toMatchObject({
    _tag: "ChatCompactionError",
    code: "compaction_failed",
  })
  expect(fixture.save).not.toHaveBeenCalled()
  expect(fixture.adapter.state.callCount).toBe(0)
})

test("portable provider failures become safe preparation errors without printing credentials", async () => {
  const fixture = compactionTestSetup()
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  const detail = vi.spyOn(console, "dir").mockImplementation(() => {})
  const adapter = createChatAdapter({
    ...compactionTestModel,
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            error: {
              message: "Invalid API key: synthetic-secret",
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
          { status: 401 },
        ),
      ),
  })
  fixture.summaryAdapter.chatStream = adapter.chatStream.bind(adapter)
  try {
    await expect(fixture.run()).rejects.toMatchObject({ code: "compaction_failed" })
    expect(log).not.toHaveBeenCalled()
    expect(detail).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
    detail.mockRestore()
  }
})

test("native failure falls back through the library to portable summarization", async () => {
  const fixture = compactionTestSetup()
  Object.assign(fixture.adapter, { compact: () => Promise.reject(new Error("Unavailable")) })
  await fixture.run(true)
  expect(fixture.state.artifact?.payload.kind).toBe("portable")
  expect(fixture.summaryAdapter.state.callCount).toBe(1)
  expect(fixture.save).toHaveBeenCalledOnce()
})

test("a long tool loop compacts later model phases without repeating committed tools", async () => {
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

test("artifact selection excludes sibling nodes and incompatible native state", () => {
  const fixture = compactionTestSetup()
  const artifact = (anchor: string, kind: "portable" | "native", key = "provider-config") =>
    ({
      coveredThroughMessageId: anchor,
      compatibilityKey: key,
      payload: { kind, version: 1, messages: [] },
    }) as unknown as ChatCompactionArtifact
  selectChatCompaction(fixture.state, [
    artifact("sibling", "portable"),
    artifact("a2", "native", "other"),
    artifact("a1", "portable"),
  ])
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("a1")
})

test("settled boundaries stop before older unfinished work and missing tool responses", () => {
  const history = compactionTestHistory()
  history[1]!.payload = {
    version: 1,
    parts: [
      ...history[1]!.payload.parts,
      {
        id: "call",
        type: "tool-call",
        name: "update",
        arguments: "{}",
        toolCallId: "call",
        targets: [{ id: "slot" }],
      },
    ],
  }
  expect(chatCompactionBoundaries(history)).toEqual([])
  history[1]!.payload = { version: 1, parts: [] }
  history[1]!.state = "draft"
  expect(chatCompactionBoundaries(history)).toEqual([])
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

test("large tool results are bounded for the model while the saved result stays intact", async () => {
  const fixture = compactionTestSetup({ ...compactionTestLimits, contextWindowTokens: 32000 })
  const output = "saved-result".repeat(4000)
  fixture.state.history.push(
    {
      ...fixture.state.history[1]!,
      id: "decision",
      turnMessageId: "u3",
      payload: {
        version: 1,
        parts: [
          {
            id: "part",
            type: "tool-call",
            name: "lookup",
            arguments: "{}",
            toolCallId: "call",
            targets: [{ id: "slot" }],
          },
        ],
      },
    },
    {
      ...fixture.state.history[1]!,
      id: "result",
      role: "tool",
      turnMessageId: "u3",
      sourceAssistantMessageId: "decision",
      sourceToolPartId: "part",
      responseTargetId: "slot",
      payload: {
        version: 1,
        parts: [{ id: "output", type: "tool-result", toolCallId: "call", output }],
      },
    },
  )
  await fixture.run()
  const sent = fixture.requests[0]!.find((message) => message.role === "tool")!
  expect(sent.content).toContain("[Truncated. Original saved in message result.]")
  expect((sent.content as string).length).toBeLessThan(17000)
  expect(fixture.state.history.at(-1)!.payload.parts[0]!.output).toBe(output)
})
