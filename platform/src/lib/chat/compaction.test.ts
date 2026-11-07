import {
  chat,
  toolDefinition,
  type ChatMiddleware,
  type ModelMessage,
  type AnyTool,
  type AnyTextAdapter,
} from "@tanstack/ai"
import { toolSchema } from "@tanstack/ai-effect"
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
import { chatCompactionBoundaries, chatCompactionMessages } from "./compaction"
import { createChatAdapter } from "./adapter"
import { chatCompactionOutputOptions } from "./compaction-middleware"
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
  const adapter: AnyTextAdapter = createChatAdapter(model, record)
  const systemPrompts = [{ content: "Current instructions", metadata: { source: "agent" } }]
  let wrapped = false
  const fixture = compactionTestSetup([
    {
      onConfig: () => ({
        systemPrompts,
        wrapFetch(fetch) {
          wrapped = true
          return fetch
        },
      }),
    },
  ])
  const compact = vi.fn(adapter.compact!.bind(adapter))
  Object.assign(fixture.adapter, { compact })
  await fixture.run(true)
  expect(wrapped).toBe(true)
  expect(compact).toHaveBeenCalledWith(expect.objectContaining({ systemPrompts }))
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

test.each(["valid", "empty", "unsupported"])("Anthropic native compaction: %s", async (state) => {
  const block = {
    type: "compaction",
    content: "AB-428 remains pending.",
    signature: "signed-state",
    encrypted_content: "opaque-state",
    tool_changes: [],
  }
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    iterations: [
      {
        type: "compaction",
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_creation: { ephemeral_1h_input_tokens: 2 },
      },
    ],
  }
  const record = vi.fn(() => Promise.resolve())
  const requests: { headers: Headers; body: Record<string, unknown> }[] = []
  const model: ChatModelConfiguration = {
    ...compactionTestModel,
    providerType: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    modelId: "claude-sonnet-5-5",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      expect(request.headers.get("x-api-key")).toBe("synthetic")
      expect(request.headers.get("authorization")).toBeNull()
      if (request.method === "GET")
        return Response.json({
          capabilities: { compaction: { summarize: { supported: state !== "unsupported" } } },
        })
      const body = (await request.json()) as Record<string, unknown>
      requests.push({ headers: request.headers, body })
      return body.compaction
        ? Response.json({
            role: "assistant",
            model: "claude-sonnet-5-5",
            content: state === "empty" ? [] : [block],
            stop_reason: state === "empty" ? "max_tokens" : "compaction",
            usage,
          })
        : Response.json(
            { error: { type: "invalid_request_error", message: "Synthetic inference boundary" } },
            { status: 400 },
          )
    },
  }
  const adapter: AnyTextAdapter = createChatAdapter(model, record)
  const fixture = compactionTestSetup()
  Object.assign(fixture.adapter, { compact: adapter.compact!.bind(adapter) })
  await fixture.run(true)
  expect(fixture.state.artifact?.payload.kind).toBe(state === "valid" ? "native" : "portable")
  expect(fixture.summaryAdapter.state.callCount).toBe(state === "valid" ? 0 : 1)
  expect(record).toHaveBeenCalledTimes(state === "unsupported" ? 0 : 1)
  expect(requests).toHaveLength(state === "unsupported" ? 0 : 1)
  if (state === "unsupported") return
  expect(record).toHaveBeenCalledWith({
    promptTokens: 115,
    completionTokens: 20,
    totalTokens: 135,
    promptTokensDetails: { cachedTokens: 10, cacheWriteTokens: 5, cacheWrite1hTokens: 2 },
    providerUsageDetails: { iterations: usage.iterations },
  })
  if (state !== "valid") return
  const tools = [
    toolDefinition({
      name: "lookup",
      description: "Look up an item",
      inputSchema: toolSchema(Schema.Struct({})),
    }).server(() => "Never executed"),
  ]
  const messages = [
    ...chatCompactionMessages(fixture.state.artifact!.payload),
    { role: "user", content: "Continue AB-428." },
    {
      role: "assistant",
      content: "Retained answer.",
      thinking: [{ content: "Synthetic retained thinking", signature: "thinking-signature" }],
    },
    { role: "user", content: "Next step?" },
  ] satisfies ModelMessage[]
  for await (const _event of adapter.chatStream({
    model: model.modelId,
    threadId: "thread",
    messages,
    systemPrompts: ["Current instructions"],
    tools,
    logger: resolveDebugOption(false),
  })) {
    /* Consume the synthetic inference error. */
  }
  const replay = requests[1]!
  expect((replay.body.messages as unknown[])[0]).toEqual({ role: "assistant", content: [block] })
  expect(JSON.stringify(replay.body.messages)).toContain("thinking-signature")
  expect(replay.headers.get("anthropic-beta")).toContain("compact-2026-09-04")
  const input = {
    model: model.modelId,
    messages,
    systemPrompts: ["Current instructions"],
    tools,
    maxTokens: 128,
  }
  await adapter.compact!(input)
  const repeated = requests[2]!
  expect((repeated.body.messages as unknown[])[0]).toEqual({ role: "assistant", content: [block] })
  expect(repeated.body.tools).toEqual(replay.body.tools)
  expect(repeated.body.system).toEqual(replay.body.system)
  expect(repeated.body.max_tokens).toBe(128)
  expect(repeated.body.stream).toBe(false)
  expect(repeated.headers.get("anthropic-beta")).toContain("compact-2026-09-04")
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

function compactionTestSetup(middleware: ChatMiddleware[] = []) {
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
  const compaction = (native = false) =>
    createChatCompactionMiddleware({
      state,
      adapter,
      summaryAdapter,
      native,
      configuration: compactionTestLimits,
      summaryOptions: {},
      onUsage: async () => {},
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
      middleware: [projection, ...middleware, compaction(native)],
      ...(abortController ? { abortController } : {}),
    })
  return { state, adapter, summaryAdapter, save, requests, run }
}

test("a large settled turn can compact while the original conversation still fits", async () => {
  const fixture = compactionTestSetup()
  fixture.state.history = fixture.state.history.slice(0, 3)
  for (const [index, size] of [3300, 3300, 2000].entries()) {
    fixture.state.history[index]!.payload = {
      version: 1,
      parts: [{ id: `text-${index}`, type: "text", content: "x".repeat(size) }],
    }
  }
  expect((await fixture.run()).text).toBe("Continued.")
  expect(fixture.summaryAdapter.state.callCount).toBe(1)
  expect(fixture.state.artifact?.coveredThroughMessageId).toBe("a1")
})

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
    if (native) {
      const adapter: AnyTextAdapter = createChatAdapter({
        ...compactionTestModel,
        providerType: "anthropic",
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        modelId: "claude-sonnet-5-5",
        fetch: async (input, init) => {
          const request = new Request(input, init)
          return request.method === "GET"
            ? Response.json({ capabilities: { compaction: { summarize: { supported: true } } } })
            : waitForAbort(request.signal)
        },
      })
      Object.assign(fixture.adapter, { compact: adapter.compact!.bind(adapter) })
    } else
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
