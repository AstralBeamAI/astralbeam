import { chat, EventType, type StreamChunk } from "@tanstack/ai"
import { Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter } from "./adapter.server.ts"

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
    providerType: "openrouter",
    api: "chat-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "anthropic/claude-sonnet-4.6",
    path: "/api/v1/chat/completions",
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("chat provider request routing", () => {
  test.each(chatAdapterCases)(
    "routes $providerType $api with its own key and upstream model",
    async (configuration) => {
      const requests: { url: URL; headers: Headers; body: { model: string } }[] = []
      vi.stubEnv("OPENAI_API_KEY", "unused-environment-openai-key")
      vi.stubEnv("ANTHROPIC_API_KEY", "unused-environment-anthropic-key")
      vi.stubEnv("OPENROUTER_API_KEY", "unused-environment-openrouter-key")
      vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
        if (typeof init.body !== "string") throw new Error("Expected a JSON request body")
        requests.push({
          url: new URL(url),
          headers: new Headers(init.headers),
          body: Schema.decodeUnknownSync(Schema.Struct({ model: Schema.String }))(
            JSON.parse(init.body),
          ),
        })
        return Promise.resolve(
          Response.json(
            { error: { type: "authentication_error", message: "Synthetic test response" } },
            { status: 401 },
          ),
        )
      })
      const adapter = createChatAdapter({
        ...configuration,
        providerId: "provider-instance",
        providerName: "Configured provider",
        apiKey: "configured-instance-key",
      })
      const events: StreamChunk[] = []
      for await (const event of chat({ adapter, messages: [{ role: "user", content: "Hello" }] }))
        events.push(event)
      expect(events.some((event) => event.type === EventType.RUN_ERROR)).toBe(true)
      expect(requests).toHaveLength(1)
      const request = requests[0]!
      expect(request.url.origin).toBe(new URL(configuration.baseUrl).origin)
      expect(request.url.pathname).toBe(configuration.path)
      expect(request.body.model).toBe(configuration.modelId)
      expect(
        request.headers.get(
          configuration.api === "anthropic-messages" ? "x-api-key" : "authorization",
        ),
      ).toBe(
        configuration.api === "anthropic-messages"
          ? "configured-instance-key"
          : "Bearer configured-instance-key",
      )
    },
  )
})
