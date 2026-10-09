import {
  chat,
  StreamProcessor,
  EventType,
  toolDefinition,
  type ModelMessage,
  type StreamChunk,
  type TextOptions,
  type AdapterYieldChunk,
} from "@tanstack/ai"
import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter } from "./adapter.server"
import { chatWebTools } from "./web.server"
import { managedChatDelivery, managedChatMiddleware } from "./threads/stream.server"
import {
  chatStoredJson,
  projectChatModelHistory,
  projectChatPublicHistory,
} from "./threads/projection.server"
import type { ChatThreads } from "./threads/threads.server"
import type { ChatMessagePayload, ChatWriterClaim } from "./threads/schemas"

const webTestSource = {
  url: "https://example.com/page",
  title: "Example",
  cited_text: "Evidence excerpt",
}

function nativeWebFixture(
  provider: "openai" | "anthropic" | "openrouter",
  pause = false,
  failure = false,
  application = false,
  fetchPage = false,
) {
  const text = "Verified answer."
  let events: object[]
  if (provider === "anthropic") {
    const blocks = [
      {
        type: "server_tool_use",
        id: "native-search",
        name: fetchPage ? "web_fetch" : "web_search",
        input: fetchPage ? { url: webTestSource.url } : { query: "test" },
      },
      {
        type: fetchPage ? "web_fetch_tool_result" : "web_search_tool_result",
        tool_use_id: "native-search",
        content: failure
          ? { type: "web_search_tool_result_error", error_code: "unavailable" }
          : fetchPage
            ? {
                type: "web_fetch_result",
                url: webTestSource.url,
                content: {
                  type: "document",
                  title: webTestSource.title,
                  source: {
                    type: "text",
                    media_type: "text/plain",
                    data: "Actual fetched page content.",
                  },
                  citations: { enabled: true },
                },
              }
            : [
                {
                  type: "web_search_result",
                  ...webTestSource,
                  encrypted_content: "opaque-evidence",
                },
              ],
      },
      { type: "text", text: "", citations: [] },
      ...(application
        ? [{ type: "tool_use", id: "application-call", name: "lookup", input: {} }]
        : []),
    ]
    events = [
      {
        type: "message_start",
        message: {
          id: "native-message",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ]
    blocks.forEach((block, index) => {
      events.push({ type: "content_block_start", index, content_block: block })
      if (block.type === "text")
        events.push(
          { type: "content_block_delta", index, delta: { type: "text_delta", text } },
          {
            type: "content_block_delta",
            index,
            delta: {
              type: "citations_delta",
              citation: fetchPage
                ? {
                    type: "char_location",
                    document_index: 0,
                    document_title: webTestSource.title,
                    cited_text: "Actual fetched page content.",
                    start_char_index: 0,
                    end_char_index: 27,
                  }
                : {
                    type: "web_search_result_location",
                    ...webTestSource,
                    encrypted_index: "opaque-index",
                  },
            },
          },
        )
      events.push({ type: "content_block_stop", index })
    })
    events.push(
      {
        type: "message_delta",
        delta: { stop_reason: pause ? "pause_turn" : application ? "tool_use" : "end_turn" },
        usage: { output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
      },
      { type: "message_stop" },
    )
  } else if (provider === "openai") {
    const search = {
      type: "web_search_call",
      id: "native-search",
      status: "completed",
      action: { type: "search", query: "test", sources: [webTestSource] },
    }
    const message = {
      type: "message",
      id: "native-message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text,
          annotations: [
            { type: "url_citation", ...webTestSource, start_index: 0, end_index: text.length },
          ],
        },
      ],
    }
    events = [
      {
        type: "response.created",
        response: { id: "response-test", model: "test-model", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...search, status: "in_progress" },
      },
      { type: "response.output_item.done", output_index: 0, item: search },
      { type: "response.output_item.added", output_index: 1, item: { ...message, content: [] } },
      {
        type: "response.output_text.delta",
        item_id: message.id,
        output_index: 1,
        content_index: 0,
        delta: text,
      },
      { type: "response.output_item.done", output_index: 1, item: message },
      {
        type: "response.completed",
        response: {
          id: "response-test",
          model: "test-model",
          status: "completed",
          output: [search, message],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ]
  } else {
    events = [
      {
        id: "gateway-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: text,
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    ...webTestSource,
                    content: "Evidence excerpt",
                    start_index: 0,
                    end_index: text.length,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "gateway-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cost: 0.012,
          server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 },
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
      .join("") + (provider === "openrouter" ? "data: [DONE]\n\n" : ""),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

async function deferredAnthropicFixture(first: boolean, application: boolean) {
  const response = nativeWebFixture("anthropic", first && !application, false, first && application)
  const keep = first ? (application ? [0, 3] : [0]) : [1, 2]
  const events = (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.split("data: ")[1]!) as { type: string; index?: number })
  return new Response(
    events
      .filter((event) => event.index === undefined || keep.includes(event.index))
      .map(
        (event) =>
          `event: ${event.type}\ndata: ${JSON.stringify(event.index === undefined ? event : { ...event, index: keep.indexOf(event.index) })}\n\n`,
      )
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

async function nativeWebRun(
  provider: "openai" | "anthropic" | "openrouter",
  options: {
    pause?: boolean
    failure?: boolean
    application?: boolean
    fetchPage?: boolean
    cancel?: boolean
    history?: ModelMessage[]
    publicHistory?: ReturnType<typeof projectChatPublicHistory>
    turnId?: string
    browser?: boolean
    response?: (request: number) => Promise<Response>
    allowError?: boolean
  } = {},
) {
  const requests: Record<string, unknown>[] = []
  const signals: AbortSignal[] = []
  const model: ChatModelConfiguration = {
    providerId: "configured-instance",
    providerType: provider,
    providerName: provider,
    api:
      provider === "openai"
        ? "responses"
        : provider === "anthropic"
          ? "anthropic-messages"
          : "chat-completions",
    modelId: "test-model",
    apiKey: "synthetic-secret",
    baseUrl: "https://provider.example/v1",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      signals.push(request.signal)
      requests.push(JSON.parse(await request.text()) as Record<string, unknown>)
      if (options.response) return options.response(requests.length)
      return nativeWebFixture(
        provider,
        options.pause && requests.length === 1,
        options.failure,
        options.application && requests.length === 1,
        options.fetchPage,
      )
    },
  }
  const claim: ChatWriterClaim = {
    scope: {
      organizationId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      tenantUserId: crypto.randomUUID(),
    },
    threadId: crypto.randomUUID(),
    inputMessageId: options.turnId ?? crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
  }
  const history: ModelMessage[] = options.history ?? [
    { role: "user", id: claim.inputMessageId, content: "Find evidence" },
  ]
  const managed = { claim, threadVersion: 1, clientId: crypto.randomUUID() }
  const saved: ChatMessagePayload[] = []
  let executed = 0
  let results = 0
  const lookup = toolDefinition({
    name: "lookup",
    description: "Application lookup",
    inputSchema: { type: "object", properties: {} },
  }).server(() => {
    executed++
    return { found: true }
  })
  const tools = [
    ...chatWebTools(model, true, []),
    ...(options.application ? [options.browser ? { ...lookup, execute: undefined } : lookup] : []),
  ]
  const threads = {
    checkpoint: ({ payload }: { payload: ChatMessagePayload }) =>
      Effect.sync(() => {
        saved.push(payload)
      }),
    assertActive: () => Effect.void,
    nextDraft: ({ claim: previous }: { claim: ChatWriterClaim }) =>
      Effect.succeed({ ...previous, assistantMessageId: crypto.randomUUID() }),
    appendToolResults: () =>
      Effect.sync(() => {
        results++
      }),
    finish: () => Effect.void,
    get: () => Effect.succeed({ lockVersion: 2 }),
  } as unknown as ChatThreads["Service"]
  const bridge = managedChatMiddleware({
    managed,
    threads,
    history,
    publicHistory: options.publicHistory,
    tools,
    model,
    agentId: "agent",
    execute: Effect.runPromise,
  })
  const adapter = createChatAdapter(model, true)
  const abortController = new AbortController()
  if (options.cancel) {
    const original = adapter.chatStream.bind(adapter) as (
      input: TextOptions,
    ) => AsyncIterable<AdapterYieldChunk>
    adapter.chatStream = async function* (input: TextOptions) {
      for await (const chunk of original(input)) {
        yield chunk
        if (chunk.type === EventType.TOOL_CALL_START) abortController.abort()
      }
    }
  }
  const chunks: StreamChunk[] = []
  let error: unknown
  try {
    for await (const chunk of managedChatDelivery({
      managed,
      state: bridge.state,
      source: chat({
        adapter,
        threadId: claim.threadId,
        messages: history,
        tools,
        abortController,
        middleware: bridge.middleware,
      }),
    }))
      chunks.push(chunk)
  } catch (cause) {
    if (!options.cancel && !options.allowError) throw cause
    error = cause
  }
  return { claim, requests, signals, saved, chunks, executed, results, model, error }
}

function nativeWebMessages(chunks: StreamChunk[]) {
  const processor = new StreamProcessor()
  for (const chunk of chunks) processor.processChunk(chunk)
  return processor.getMessages()
}

describe("native web access", () => {
  test.each(["openai", "anthropic", "openrouter"] as const)(
    "delivers saved citations and settled activity for native-only %s answers",
    async (provider) => {
      const result = await nativeWebRun(provider)
      const parts = nativeWebMessages(result.chunks)
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts)
      const saved = result.saved.at(-1)!.parts
      expect(parts.map((part) => chatStoredJson(part).id)).toEqual(saved.map((part) => part.id))
      expect(parts.find((part) => part.type === "text")).toMatchObject({
        metadata: { web: { citations: [{ url: webTestSource.url }] } },
      })
      expect(parts.find((part) => part.type === "tool-call")).toMatchObject({ state: "complete" })
      const sourceLists = parts.filter(
        (part) => part.type === "tool-call" && JSON.stringify(part).includes(webTestSource.url),
      )
      expect(sourceLists).toHaveLength(1)
      const payload = result.saved.at(-1)!
      for (const part of saved.filter((part) => part.type === "tool-call"))
        expect(part).toMatchObject({ executionLocation: "provider", targets: [] })
      expect(result).toMatchObject({ executed: 0, results: 0 })
      expect(JSON.stringify(result.chunks)).not.toContain("opaque-")
      expect(JSON.stringify(payload.parts)).not.toContain("opaque-")
      expect(payload.provenance?.usage).toHaveProperty("providerUsage")
      expect(result.requests[0]!.max_tool_calls).toBe(provider === "anthropic" ? undefined : 5)
      expect((payload.provenance?.usage as { cost?: number })?.cost).toBe(
        provider === "openrouter" ? 0.012 : undefined,
      )
      const records = [
        { id: "saved", role: "assistant" as const, state: "complete" as const, payload },
      ]
      const projected = projectChatModelHistory(records, {
        providerId: result.model.providerId,
        protocol: result.model.api,
        modelId: result.model.modelId,
      })
      const followUp = await nativeWebRun(provider, {
        history: [...projected, { role: "user", content: "Explain that evidence" }],
      })
      expect(JSON.stringify(followUp.requests[0]).includes("opaque-evidence")).toBe(
        provider === "anthropic",
      )
      expect(
        provider !== "openrouter" || JSON.stringify(followUp.requests[0]).includes('"annotations"'),
      ).toBe(true)
      expect(
        provider !== "openrouter" ||
          (followUp.requests[0]!.messages as { tool_calls?: unknown[] }[]).some(
            (message) => message.tool_calls?.length,
          ) === false,
      ).toBe(true)
      const portable = projectChatModelHistory(records, {
        providerId: "other",
        protocol: result.model.api,
        modelId: result.model.modelId,
      })
      expect(JSON.stringify(portable)).toContain(webTestSource.url)
      expect(JSON.stringify(portable)).not.toContain("opaque-")
      expect(JSON.stringify(portable).match(/Saved web evidence:/g)).toHaveLength(1)
      expect(portable.some((message) => message.toolCalls?.length)).toBe(false)
    },
  )

  test("preserves earlier citations at a browser wait after a provider change", async () => {
    const first = await nativeWebRun("anthropic")
    const records = [
      {
        id: "previous-answer",
        role: "assistant" as const,
        state: "complete" as const,
        payload: first.saved.at(-1)!,
      },
    ]
    const second = await nativeWebRun("anthropic", {
      application: true,
      browser: true,
      history: [
        ...projectChatModelHistory(records),
        { id: "follow-up", role: "user", content: "Explain that evidence" },
      ],
      publicHistory: projectChatPublicHistory(records),
    })
    const messages = nativeWebMessages(second.chunks)
    expect(messages.find((message) => message.id === "previous-answer")!.parts).toEqual(
      records[0]!.payload.parts,
    )
    expect(second).toMatchObject({ executed: 0, results: 0 })
    expect(JSON.stringify(messages)).not.toContain("Saved web evidence:")
  })

  test("records deferred Anthropic results across an application turn", async () => {
    const result = await nativeWebRun("anthropic", {
      application: true,
      response: (request) => deferredAnthropicFixture(request === 1, true),
    })
    expect(result.requests).toHaveLength(2)
    expect(
      result.saved.at(-1)!.parts.find((part) => part.executionLocation === "provider"),
    ).toMatchObject({ name: "web_search", state: "complete", targets: [] })
    expect(result).toMatchObject({ executed: 1, results: 1 })
    expect(
      nativeWebMessages(result.chunks)
        .flatMap((message) => message.parts)
        .filter(
          (part) =>
            part.type === "tool-call" && chatStoredJson(part).executionLocation === "provider",
        )
        .every((part) => part.type === "tool-call" && part.state === "complete"),
    ).toBe(true)
  })

  test("deferred Anthropic activity settles across a saved browser-tool continuation", async () => {
    const first = await nativeWebRun("anthropic", {
      application: true,
      browser: true,
      response: () => deferredAnthropicFixture(true, true),
    })
    const decision = first.saved.at(-1)!
    const application = decision.parts.find((part) => part.executionLocation === "browser")!
    const target = (application.targets as { id: string }[])[0]!
    const records = [
      { id: "decision", role: "assistant" as const, state: "complete" as const, payload: decision },
      {
        id: "result",
        role: "tool" as const,
        state: "complete" as const,
        sourceAssistantMessageId: "decision",
        sourceToolPartId: String(application.id),
        responseTargetId: target.id,
        payload: {
          version: 1 as const,
          parts: [
            {
              id: "result-part",
              type: "tool-result",
              toolCallId: application.toolCallId!,
              outcome: "succeeded",
              output: { found: true },
            },
          ],
        },
      },
    ]
    const second = await nativeWebRun("anthropic", {
      turnId: first.claim.inputMessageId,
      history: projectChatModelHistory(records, {
        providerId: first.model.providerId,
        protocol: first.model.api,
        modelId: first.model.modelId,
      }),
      publicHistory: projectChatPublicHistory(records),
      response: () => deferredAnthropicFixture(false, true),
    })
    expect(second.results).toBe(0)
    expect(
      second.saved.at(-1)!.parts.find((part) => part.executionLocation === "provider"),
    ).toMatchObject({ state: "complete", targets: [] })
    expect(
      nativeWebMessages(second.chunks)
        .find((message) => message.id === "decision")!
        .parts.find((part) => part.type === "tool-call"),
    ).toMatchObject({ state: "complete" })
    expect(JSON.stringify(second.requests)).toContain("server_tool_use")
    const unrelated = projectChatPublicHistory([
      ...records,
      {
        id: "other-turn",
        role: "assistant",
        state: "complete",
        payload: {
          version: 1,
          parts: [
            {
              ...decision.parts.find((part) => part.executionLocation === "provider")!,
              state: "complete",
              providerTurnId: "other-turn",
            },
          ],
        },
      },
    ])
    expect(unrelated[0]!.parts.find((part) => part.executionLocation === "provider")).toMatchObject(
      { state: "input-complete" },
    )
  })

  test("retains returned OpenAI evidence on an incomplete response", async () => {
    const result = await nativeWebRun("openai", {
      allowError: true,
      response: async () =>
        new Response(
          (await nativeWebFixture("openai").text())
            .replace("response.completed", "response.incomplete")
            .replace(
              '"status":"completed","output"',
              '"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output"',
            ),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    })
    expect(result.error).toBeDefined()
    expect(result.saved.at(-1)!.parts.find((part) => part.type === "text")).toMatchObject({
      metadata: { web: { citations: [{ url: webTestSource.url }] } },
    })
    expect(
      result.saved.at(-1)!.parts.find((part) => part.executionLocation === "provider"),
    ).toMatchObject({ state: "complete" })
    expect(
      result.chunks.some(
        (chunk) =>
          chunk.type === EventType.CUSTOM && (chunk.value as { saved?: boolean }).saved === true,
      ),
    ).toBe(false)
  })

  test("interrupted native calls persist as failed activity without pending application results", async () => {
    const result = await nativeWebRun("anthropic", { cancel: true })
    expect(result.error).toMatchObject({ message: "Conversation could not be saved" })
    expect(result.signals.every((signal) => signal.aborted)).toBe(true)
    expect(result.requests).toHaveLength(1)
    expect(result).toMatchObject({ executed: 0, results: 0 })
    expect(result.saved.at(-1)?.parts.find((part) => part.type === "tool-call")).toMatchObject({
      state: "error",
      executionLocation: "provider",
      targets: [],
      output: { error: "Web retrieval failed" },
    })
  })
  test("Anthropic fetched-document citations resolve to the returned URL and excerpt", async () => {
    const result = await nativeWebRun("anthropic", { fetchPage: true })
    const payload = result.saved.at(-1)!
    expect(payload.parts.find((part) => part.type === "text")).toMatchObject({
      metadata: {
        web: {
          citations: [
            {
              url: webTestSource.url,
              title: webTestSource.title,
              excerpt: "Actual fetched page content.",
              endIndex: 16,
            },
          ],
        },
      },
    })
    expect(payload.parts.find((part) => part.type === "tool-call")).toMatchObject({
      name: "web_fetch",
      executionLocation: "provider",
      metadata: {
        web: { sources: [{ url: webTestSource.url, excerpt: "Actual fetched page content." }] },
      },
    })
  })
  test("Anthropic resumes pause_turn with unchanged server evidence and sums request usage", async () => {
    const result = await nativeWebRun("anthropic", { pause: true })
    expect(result.requests).toHaveLength(2)
    expect(JSON.stringify(result.requests[1])).toContain("opaque-evidence")
    expect(result.chunks.filter((chunk) => chunk.type === EventType.RUN_FINISHED)).toHaveLength(1)
    expect(result.saved.at(-1)!.provenance?.usage).toMatchObject({
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    })
    const citations = result.saved
      .at(-1)!
      .parts.filter((part) => part.type === "text")
      .flatMap(
        (part) => (part.metadata as { web: { citations: { endIndex: number }[] } }).web.citations,
      )
    expect(citations).toHaveLength(2)
  })

  test("a server-tool error in a successful HTTP response is saved as failed activity", async () => {
    const result = await nativeWebRun("anthropic", { failure: true })
    expect(result.saved.at(-1)!.parts.find((part) => part.type === "tool-call")).toMatchObject({
      executionLocation: "provider",
      state: "error",
      targets: [],
    })
  })

  test("disabled access declares no native tools and enabled access rejects protocol and name collisions", () => {
    const model = { providerType: "openai", api: "chat-completions" } as ChatModelConfiguration
    expect(chatWebTools(model, false, [{ name: "web_search" }])).toEqual([])
    expect(() => chatWebTools(model, true, [])).toThrow("Select Responses")
    expect(() =>
      chatWebTools({ ...model, api: "responses" }, true, [{ name: "web_fetch" }]),
    ).toThrow("reserved")
    expect(() =>
      chatWebTools({ ...model, api: "responses", modelId: "gpt-audio" }, true, []),
    ).toThrow("does not support")
  })

  test("Anthropic pause continuations stay within the model-turn budget", async () => {
    const result = await nativeWebRun("anthropic", {
      allowError: true,
      response: () => Promise.resolve(nativeWebFixture("anthropic", true)),
    })
    expect(result.chunks.find((chunk) => chunk.type === EventType.RUN_ERROR)).toMatchObject({
      code: "web_continuation_limit",
      usage: { promptTokens: 250, completionTokens: 125, totalTokens: 375 },
    })
    expect(result.requests).toHaveLength(25)
  })

  test("the OpenRouter adapter preserves inline documents, configured URLs, and guarded credentials", async () => {
    let body: Record<string, unknown> | undefined
    const model: ChatModelConfiguration = {
      providerId: "configured-instance",
      providerType: "openrouter",
      providerName: "OpenRouter",
      api: "chat-completions",
      modelId: "custom-model",
      apiKey: "synthetic-secret",
      baseUrl: "https://provider.example/api/v1",
      fetch: async (input, init) => {
        const request = new Request(input, init)
        expect(request.url).toBe("https://provider.example/api/v1/chat/completions")
        expect(request.headers.get("Authorization")).toBe("Bearer synthetic-secret")
        body = JSON.parse(await request.text()) as Record<string, unknown>
        return nativeWebFixture("openrouter")
      },
    }
    for await (const _chunk of chat({
      adapter: createChatAdapter(model, true),
      tools: chatWebTools(model, true, []),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", content: "Read this document" },
            {
              type: "document",
              source: { type: "data", value: "JVBERg==", mimeType: "application/pdf" },
              metadata: { filename: "notes.pdf" },
            },
          ],
        },
      ],
    })) {
      /* Consume the adapter's document request. */
    }
    expect(JSON.stringify(body)).toContain('"file_data":"data:application/pdf;base64,JVBERg=="')
    expect(JSON.stringify(body)).not.toContain("[Attached document]")
  })

  test("native tool rejection is classified safely without retry", async () => {
    const result = await nativeWebRun("openai", {
      allowError: true,
      response: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                type: "invalid_request_error",
                code: "invalid_request_error",
                message: "web_search rejected private-gateway synthetic-secret",
              },
            },
            { status: 400 },
          ),
        ),
    })
    expect(result.requests).toHaveLength(1)
    expect(result.chunks.find((chunk) => chunk.type === EventType.RUN_ERROR)).toMatchObject({
      code: "web_access_unavailable",
    })
    expect(JSON.stringify(result.chunks)).not.toContain("synthetic-secret")
  })
})
