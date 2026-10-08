import { chat, EventType, type StreamChunk } from "@tanstack/ai"
import { afterEach, describe, expect, test, vi } from "vitest"

import { modelUsageTestConfiguration } from "@/lib/model-providers/usage.test-support"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { createChatAdapter, modelOutputOptions } from "./adapter.server.ts"

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
      vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unused-environment-anthropic-token")
      vi.stubEnv("OPENAI_ORG_ID", "unused-environment-openai-organization")
      const configuredFetch: typeof fetch = async (input, init) => {
        const request = new Request(input, init)
        requests.push({
          url: new URL(input instanceof Request ? input.url : input),
          headers: request.headers,
          body: JSON.parse(await request.text()) as { model: string },
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
        providerModelId: "configured-model",
        usageConfiguration: modelUsageTestConfiguration,
        providerId: "provider-instance",
        providerName: "Configured provider",
        apiKey: "configured-instance-key",
        fetch: configuredFetch,
      })
      const events: StreamChunk[] = []
      for await (const event of chat({
        adapter,
        modelOptions: modelOutputOptions(configuration, 4096),
        messages: [{ role: "user", content: "Hello" }],
      }))
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
      expect(request.headers.get("authorization")).toBe(
        configuration.api === "anthropic-messages" ? null : "Bearer configured-instance-key",
      )
      expect(request.headers.get("openai-organization")).toBeNull()
    },
  )
  test.each(chatAdapterCases)(
    "rejects unbounded $providerType $api requests and disables transient retries",
    async (configuration) => {
      for (const cap of [4096, 4097]) {
        let calls = 0
        const adapter = createChatAdapter({
          ...configuration,
          providerModelId: "configured-model",
          providerId: "provider",
          providerName: "Test",
          apiKey: "test-key",
          usageConfiguration: modelUsageTestConfiguration,
          fetch: () => {
            calls += 1
            return Promise.resolve(
              Response.json(
                { error: { message: "Synthetic error" } },
                { status: 500, headers: { "retry-after-ms": "1" } },
              ),
            )
          },
        })
        for await (const _event of chat({
          adapter,
          debug: false,
          modelOptions: modelOutputOptions(configuration, cap),
          messages: [{ role: "user", content: "Hello" }],
        })) {
          // Drain failures through the real SDK to catch hidden retries.
        }
        expect(calls).toBe(cap === 4096 ? 1 : 0)
      }
    },
  )
})
