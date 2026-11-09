import { OrganizationIdSchema, TenantIdSchema, TenantUserIdSchema } from "@/db/schema/organizations"
import {
  EventType,
  modelMessagesToUIMessages,
  StreamProcessor,
  toolDefinition,
  type ModelMessage,
} from "@tanstack/ai"
import { chat } from "@tanstack/ai-effect"
import { Effect, Schema, Stream } from "effect"
import { expect, test } from "vitest"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter } from "./adapter"
import { chatWebTools } from "./web"
import { modelWebAccess } from "@/lib/model-providers/web.server"
import { managedChatMiddleware, managedChatDelivery } from "./threads/stream"
import { projectChatModelHistory } from "./threads/projection"
import type { ChatThreads } from "./threads/threads"
import type { ChatMessagePayload, ChatWriterClaim, ChatToolResolution } from "./threads/schemas"

const webAnswer = "Verified answer."
const webSourceUrl = "https://example.com/page"

function anthropicReplayBlockTypes(request: Schema.JsonObject) {
  return (request.messages as Schema.JsonObject[])
    .flatMap((message) =>
      message.role === "assistant" ? (message.content as Schema.JsonObject[]) : [],
    )
    .map((block) => block.type)
}

function webResponse(provider: "openai" | "anthropic", application = false) {
  let events: object[]
  if (provider === "anthropic") {
    const blocks = [
      { type: "thinking", thinking: "", signature: "" },
      {
        type: "server_tool_use",
        id: "search",
        name: "web_fetch",
        input: { url: webSourceUrl },
      },
      {
        type: "web_fetch_tool_result",
        tool_use_id: "search",
        content: {
          type: "web_fetch_result",
          url: webSourceUrl,
          content: {
            type: "document",
            title: "Example",
            source: { type: "text", media_type: "text/plain", data: "Actual page" },
          },
        },
      },
      ...(application ? [{ type: "thinking", thinking: "", signature: "" }] : []),
      { type: "text", text: "" },
      ...(application ? [{ type: "tool_use", id: "call", name: "lookup", input: {} }] : []),
    ]
    events = [
      {
        type: "message_start",
        message: {
          id: "response",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [],
          usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 2 },
        },
      },
    ]
    for (const [index, block] of blocks.entries()) {
      events.push({ type: "content_block_start", index, content_block: block })
      if (block.type === "thinking")
        events.push(
          {
            type: "content_block_delta",
            index,
            delta: { type: "thinking_delta", thinking: "Check the source before answering." },
          },
          {
            type: "content_block_delta",
            index,
            delta: { type: "signature_delta", signature: "synthetic-signature" },
          },
        )
      if (block.type === "text")
        events.push({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: webAnswer },
        })
      events.push({ type: "content_block_stop", index })
    }
    events.push(
      {
        type: "message_delta",
        delta: { stop_reason: application ? "tool_use" : "end_turn" },
        usage: { output_tokens: 5, server_tool_use: { web_fetch_requests: 1 } },
      },
      { type: "message_stop" },
    )
  } else {
    const search = {
      type: "web_search_call",
      id: "search",
      status: "completed",
      action: { type: "open_page", url: webSourceUrl },
    }
    const message = {
      type: "message",
      id: "answer",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: webAnswer,
        },
      ],
    }
    const call = {
      type: "function_call",
      id: "function-item",
      call_id: "call",
      name: "lookup",
      arguments: "{}",
      status: "completed",
    }
    events = [
      { type: "response.created", response: { id: "response", model: "test-model", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...search, status: "in_progress" },
      },
      { type: "response.output_item.done", output_index: 0, item: search },
      { type: "response.output_item.added", output_index: 1, item: { ...message, content: [] } },
      {
        type: "response.output_text.delta",
        item_id: "answer",
        output_index: 1,
        content_index: 0,
        delta: webAnswer,
      },
      { type: "response.output_item.done", output_index: 1, item: message },
      ...(application
        ? [
            { type: "response.output_item.added", output_index: 2, item: call },
            { type: "response.output_item.done", output_index: 2, item: call },
          ]
        : []),
      {
        type: "response.completed",
        response: {
          id: "response",
          model: "test-model",
          status: "completed",
          output: [search, message, ...(application ? [call] : [])],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ]
  }
  return new Response(
    events
      .map(
        (event) =>
          `${provider === "anthropic" ? `event: ${(event as { type: string }).type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

async function exerciseNativeWeb(provider: "openai" | "anthropic", application: boolean) {
  const requests: Schema.JsonObject[] = []
  const model: ChatModelConfiguration = {
    providerId: "provider",
    providerName: provider,
    providerType: provider,
    api: provider === "openai" ? "responses" : "anthropic-messages",
    modelId: "test-model",
    apiKey: "synthetic-key",
    baseUrl: "https://provider.example/v1",
    fetch: async (input, init) => {
      requests.push(
        Schema.decodeUnknownSync(Schema.JsonObject)(await new Request(input, init).json()),
      )
      return webResponse(provider, application && requests.length === 1)
    },
  }
  const claim: ChatWriterClaim = {
    scope: {
      organizationId: OrganizationIdSchema.make("019a0000-0000-7000-8000-000000000001"),
      tenantId: TenantIdSchema.make(crypto.randomUUID()),
      tenantUserId: TenantUserIdSchema.make(crypto.randomUUID()),
    },
    threadId: crypto.randomUUID(),
    inputMessageId: crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
  }
  const managed = { claim, threadVersion: 1, clientId: "browser" }
  const history: ModelMessage[] = [
    { id: claim.inputMessageId, role: "user", content: "Read the web" },
  ]
  const saved: ChatMessagePayload[] = []
  const applicationResults: ChatToolResolution[] = []
  const threads = {
    checkpoint: ({ payload }: { payload: ChatMessagePayload }) =>
      Effect.sync(() => {
        saved.push(payload)
      }),
    assertActive: () => Effect.void,
    nextDraft: ({ claim: previous }: { claim: ChatWriterClaim }) =>
      Effect.succeed({ ...previous, assistantMessageId: crypto.randomUUID() }),
    appendToolResults: ({ results }: { results: ChatToolResolution[] }) =>
      Effect.sync(() => {
        applicationResults.push(...results)
      }),
    finish: () => Effect.void,
    get: () => Effect.succeed({ lockVersion: 2 }),
  } as unknown as ChatThreads["Service"]
  const tools = [
    ...chatWebTools(model, true, []),
    toolDefinition({
      name: "lookup",
      description: "Application",
      inputSchema: { type: "object" },
    }).server(() => "found"),
  ]
  const bridge = managedChatMiddleware({
    managed,
    threads,
    history,
    tools,
    model,
    agentId: "agent",
    publicHistory: modelMessagesToUIMessages(history),
    execute: Effect.runPromise,
  })
  const source = chat({
    adapter: createChatAdapter(model),
    messages: history,
    tools,
    threadId: claim.threadId,
    middleware: bridge.middleware,
  })
  const chunks = await Effect.runPromise(
    Stream.runCollect(managedChatDelivery({ managed, state: bridge.state, source })),
  )
  if (!application) {
    const replay = projectChatModelHistory(
      [
        {
          id: claim.assistantMessageId,
          role: "assistant",
          state: "complete",
          payload: saved.at(-1)!,
        },
      ],
      {
        providerId: model.providerId,
        protocol: model.api,
        modelId: model.modelId,
        webAccessEnabled: true,
      },
    )
    await Effect.runPromise(
      Stream.runDrain(
        chat({
          adapter: createChatAdapter(model),
          threadId: claim.threadId,
          tools,
          messages: [...history, ...replay, { role: "user", content: "Continue" }],
        }),
      ),
    )
  }
  return { model, claim, saved, applicationResults, requests, chunks }
}

test.each(["openai", "anthropic"] as const)(
  "%s persists native web tools and replays them alongside application tools",
  async (provider) => {
    const { model, claim, saved, applicationResults, requests, chunks } = await exerciseNativeWeb(
      provider,
      true,
    )
    expect(chunks.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(false)
    expect(requests).toHaveLength(2)
    expect(applicationResults).toHaveLength(1)
    const native = saved
      .flatMap((payload) => payload.parts)
      .filter((part) => part.executionLocation === "provider")
    expect(native.length).toBeGreaterThan(0)
    expect(native.every((part) => Array.isArray(part.targets) && part.targets.length === 0)).toBe(
      true,
    )
    expect(
      native.every(
        (part) => part.metadata && (part.metadata as Schema.JsonObject).providerExecuted === true,
      ),
    ).toBe(true)
    const payload = saved.find((payload) =>
      payload.parts.some((part) => part.executionLocation === "provider"),
    )!
    const records: Parameters<typeof projectChatModelHistory>[0] = [
      { id: claim.assistantMessageId, role: "assistant", state: "complete", payload },
      ...applicationResults.map((result) => ({
        id: crypto.randomUUID(),
        role: "tool" as const,
        state: "complete" as const,
        sourceAssistantMessageId: result.assistantMessageId,
        sourceToolPartId: result.toolPartId,
        responseTargetId: result.responseTargetId,
        payload: result.payload,
      })),
    ]
    const replay = projectChatModelHistory(records, {
      providerId: model.providerId,
      protocol: model.api,
      modelId: model.modelId,
      webAccessEnabled: true,
    })
    expect(JSON.stringify(replay)).toContain('"providerExecuted":true')
    expect(JSON.stringify(requests[1])).toContain(
      provider === "openai" ? '"function_call_output"' : '"tool_result"',
    )
    expect(JSON.stringify(requests[1])).toContain(
      provider === "openai" ? '"web_search_call"' : '"server_tool_use"',
    )
    expect(provider === "anthropic" ? anthropicReplayBlockTypes(requests[1]!) : undefined).toEqual(
      provider === "anthropic"
        ? ["thinking", "server_tool_use", "web_fetch_tool_result", "thinking", "text", "tool_use"]
        : undefined,
    )
    const portable = projectChatModelHistory(records, {
      providerId: "other-provider",
      protocol: model.api,
      modelId: model.modelId,
    })
    expect(JSON.stringify(portable)).not.toContain('"providerExecuted"')
  },
)

test.each(["openai", "anthropic"] as const)(
  "%s keeps one complete web tool in saved and streamed web-only replies",
  async (provider) => {
    const { saved, requests, chunks, applicationResults } = await exerciseNativeWeb(provider, false)
    expect(requests).toHaveLength(2)
    expect(applicationResults).toHaveLength(0)
    const native = saved.at(-1)!.parts.filter((part) => part.executionLocation === "provider")
    expect(native).toHaveLength(1)
    expect(native[0]?.state).toBe("complete")
    const model = saved.at(-1)!.modelMessages![0]!
    expect(model.metadata).toMatchObject({
      tanstack: { model: "test-model", responseId: "response", finishReason: "stop" },
    })
    expect(model.thinking).toEqual(
      provider === "anthropic"
        ? [{ content: "Check the source before answering.", signature: "synthetic-signature" }]
        : undefined,
    )
    expect(model.blockOrder).toEqual(
      provider === "anthropic"
        ? [
            { type: "thinking", index: 0 },
            { type: "tool-call", id: "search" },
            { type: "text", length: webAnswer.length },
          ]
        : undefined,
    )
    expect(provider === "anthropic" ? anthropicReplayBlockTypes(requests[1]!) : undefined).toEqual(
      provider === "anthropic"
        ? ["thinking", "server_tool_use", "web_fetch_tool_result", "text"]
        : undefined,
    )
    const processor = new StreamProcessor()
    for (const chunk of chunks) processor.processChunk(chunk)
    const live = processor
      .getMessages()
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "tool-call")
    expect(live).toHaveLength(1)
    expect(live[0]?.id).toBe("search")
    expect(live[0]?.state).toBe("complete")
  },
)

test("disabled access, unsupported models and reserved browser names enforce the grant", () => {
  const model = {
    providerType: "openai",
    api: "chat-completions",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-audio",
  } as ChatModelConfiguration
  expect(chatWebTools(model, false, [{ name: "web_search", description: "Browser tool" }])).toEqual(
    [],
  )
  expect(() => chatWebTools(model, true, [])).toThrow()
  expect(() => chatWebTools({ ...model, api: "responses" }, true, [])).toThrow()
  const grok = { providerType: "xai", api: "responses", baseUrl: "https://api.x.ai/v1" } as const
  expect(modelWebAccess({ ...grok, modelId: "grok-4.7" })).toBe(true)
  expect(modelWebAccess({ ...grok, modelId: "grok-custom" })).toBeNull()
  expect(() =>
    chatWebTools({ ...model, api: "responses", modelId: "custom" }, true, [
      { name: "web_fetch", description: "Browser tool" },
    ]),
  ).toThrow()
})
