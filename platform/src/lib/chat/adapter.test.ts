import { chat, EventType, maxIterations, toolDefinition, type StreamChunk } from "@tanstack/ai"
import { Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter } from "./adapter.ts"

const chatAdapterCases: readonly (Pick<
  ChatModelConfiguration,
  "providerType" | "api" | "baseUrl" | "modelId"
> & { readonly path: string })[] = [
  {
    providerType: "openai",
    api: "responses",
    baseUrl: "https://openai.example/v1",
    modelId: "custom-openai-model",
    path: "/v1/responses",
  },
  {
    providerType: "openai",
    api: "chat-completions",
    baseUrl: "https://gateway.example/v1",
    modelId: "custom-compatible-model",
    path: "/v1/chat/completions",
  },
  {
    providerType: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://anthropic.example",
    modelId: "custom-claude-model",
    path: "/v1/messages",
  },
  {
    providerType: "google",
    api: "gemini-generate-content",
    baseUrl: "https://gemini.example",
    modelId: "custom-gemini-model",
    path: "/v1beta/models/custom-gemini-model:streamGenerateContent",
  },
  {
    providerType: "xai",
    api: "responses",
    baseUrl: "https://xai.example/v1",
    modelId: "custom-grok-model",
    path: "/v1/responses",
  },
  {
    providerType: "openrouter",
    api: "chat-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "anthropic/claude-sonnet-4.6",
    path: "/api/v1/chat/completions",
  },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("chat provider request routing", () => {
  test.each(chatAdapterCases)(
    "routes $providerType $api with its own key and upstream model",
    async (configuration) => {
      const requests: { url: URL; headers: Headers; body: { model?: string | undefined } }[] = []
      vi.stubEnv("GEMINI_API_KEY", "unused-environment-gemini-key")
      vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true")
      vi.stubEnv("XAI_API_KEY", "unused-environment-xai-key")
      vi.stubEnv("OPENAI_API_KEY", "unused-environment-openai-key")
      vi.stubEnv("ANTHROPIC_API_KEY", "unused-environment-anthropic-key")
      vi.stubEnv("OPENROUTER_API_KEY", "unused-environment-openrouter-key")
      vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unused-environment-anthropic-token")
      vi.stubEnv("OPENAI_ORG_ID", "unused-environment-openai-organization")
      const configuredFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (
        input,
        init,
      ) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body")
        requests.push({
          url: new URL(input instanceof Request ? input.url : input),
          headers: new Headers(init.headers),
          body: Schema.decodeUnknownSync(Schema.Struct({ model: Schema.optional(Schema.String) }))(
            JSON.parse(init.body),
          ),
        })
        return Promise.resolve(
          Response.json(
            { error: { type: "authentication_error", message: "Synthetic test response" } },
            { status: 401 },
          ),
        )
      }
      const adapter = createChatAdapter({
        ...configuration,
        providerId: "provider-instance",
        providerName: "Configured provider",
        apiKey: "configured-instance-key",
        fetch: configuredFetch,
      })
      const events: StreamChunk[] = []
      for await (const event of chat({
        threadId: "provider-test",
        adapter,
        messages: [{ role: "user", content: "Hello" }],
      }))
        events.push(event)
      expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(true)
      expect(requests).toHaveLength(1)
      const request = requests[0]!
      expect(request.url.origin).toBe(new URL(configuration.baseUrl).origin)
      expect(request.url.pathname).toBe(configuration.path)
      // Gemini names the model in the path.
      expect(request.body.model).toBe(
        configuration.providerType === "google" ? undefined : configuration.modelId,
      )
      const keyHeader =
        configuration.api === "anthropic-messages"
          ? "x-api-key"
          : configuration.api === "gemini-generate-content"
            ? "x-goog-api-key"
            : null
      expect(request.headers.get(keyHeader ?? "authorization")).toBe(
        keyHeader ? "configured-instance-key" : "Bearer configured-instance-key",
      )
      expect(request.headers.get("authorization")).toBe(
        keyHeader ? null : "Bearer configured-instance-key",
      )
      expect(request.url.search).not.toContain("key=")
      expect(request.headers.get("openai-organization")).toBeNull()
    },
  )
})

const lookupCall = {
  type: "function_call",
  id: "fc",
  call_id: "call",
  name: "lookup",
  arguments: "{}",
}
const nativeTurnCases = [
  {
    providerType: "google",
    api: "gemini-generate-content",
    baseUrl: "https://gemini.example",
    turns: [
      [
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { name: "lookup", args: {} }, thoughtSignature: "signed" }],
              },
              finishReason: "STOP",
            },
          ],
        },
      ],
      [
        {
          candidates: [
            { content: { role: "model", parts: [{ text: "Done" }] }, finishReason: "STOP" },
          ],
        },
      ],
    ],
    attachments: ['"mimeType":"image/png"', '"mimeType":"application/pdf"'],
    continuation: ['"thoughtSignature":"signed"', '"functionResponse":{'],
  },
  {
    providerType: "xai",
    api: "responses",
    baseUrl: "https://xai.example/v1",
    turns: [
      [
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "reasoning", id: "rs", encrypted_content: "signed", summary: [] },
        },
        { type: "response.output_item.added", output_index: 1, item: lookupCall },
        { type: "response.output_item.done", output_index: 1, item: lookupCall },
        { type: "response.completed", response: { id: "r1", status: "completed", output: [] } },
      ],
      [
        { type: "response.output_text.delta", item_id: "m", output_index: 0, delta: "Done" },
        { type: "response.completed", response: { id: "r2", status: "completed", output: [] } },
      ],
    ],
    attachments: ['"type":"input_image"', '"type":"input_file"'],
    continuation: ['"encrypted_content":"signed"', '"type":"function_call_output"'],
  },
] as const

describe("native Gemini and Grok turns", () => {
  test.each(nativeTurnCases)(
    "streams $providerType attachments, tool calls, and signed continuations",
    async ({ turns, attachments, continuation, ...configuration }) => {
      const bodies: string[] = []
      const adapter = createChatAdapter({
        ...configuration,
        providerId: "provider-instance",
        providerName: "Configured provider",
        apiKey: "configured-instance-key",
        modelId: "custom-model",
        fetch: (_input, init) => {
          if (typeof init?.body !== "string") throw new Error("Expected a JSON request body")
          bodies.push(init.body)
          return Promise.resolve(
            new Response(
              (turns[bodies.length - 1] ?? [])
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(""),
              { headers: { "content-type": "text/event-stream" } },
            ),
          )
        },
      })
      const lookup = toolDefinition({
        name: "lookup",
        description: "Look up",
        inputSchema: { type: "object" },
      }).server(() => ({ ok: true }))
      const events: StreamChunk[] = []
      for await (const event of chat({
        threadId: "provider-test",
        adapter,
        tools: [lookup],
        agentLoopStrategy: maxIterations(2),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", content: "Read these" },
              {
                type: "image",
                source: { type: "data", value: "iVBORw0KGgo=", mimeType: "image/png" },
              },
              {
                type: "document",
                source: { type: "data", value: "JVBERi0=", mimeType: "application/pdf" },
              },
            ],
          },
        ],
      }))
        events.push(event)
      expect(bodies).toHaveLength(2)
      for (const fragment of attachments) expect(bodies[0]).toContain(fragment)
      for (const fragment of continuation) expect(bodies[1]).toContain(fragment)
      expect(
        events.flatMap((event) =>
          event.type === EventType.TEXT_MESSAGE_CONTENT ? [event.delta] : [],
        ),
      ).toEqual(["Done"])
      expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED)
    },
  )
})
