import { createModel, extendAdapter } from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createGeminiChat } from "@tanstack/ai-gemini"
import { createGrokText } from "@tanstack/ai-grok"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { createOpenRouterText } from "@tanstack/ai-openrouter"
import { HTTPClient } from "@openrouter/sdk/lib/http"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

export function chatModelOutputOptions(
  model: Pick<ChatModelConfiguration, "api" | "providerType">,
  maxTokens: number,
) {
  if (model.providerType === "openrouter") return { maxCompletionTokens: maxTokens }
  if (model.api === "responses") return { max_output_tokens: maxTokens }
  if (model.api === "gemini-generate-content") return { maxOutputTokens: maxTokens }
  return model.api === "chat-completions" && model.providerType === "openai"
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}

export function createChatAdapter(configuration: ChatModelConfiguration) {
  const models = [createModel(configuration.modelId, ["text", "image", "document"])]
  if (configuration.providerType === "openai" && configuration.api === "responses") {
    const createOpenaiModel = extendAdapter(createOpenaiChat, models)
    // Null stops the SDK reading OPENAI_ORG_ID and OPENAI_PROJECT_ID from the deployment.
    return createOpenaiModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      organization: null,
      project: null,
    })
  }
  if (configuration.api === "anthropic-messages") {
    const createAnthropicModel = extendAdapter(createAnthropicChat, models)
    // Explicit auth keeps deployment tokens out of this Organization's connection.
    return createAnthropicModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      auth: "api-key",
    })
  }
  if (configuration.api === "gemini-generate-content") {
    const createGeminiModel = extendAdapter(createGeminiChat, models)
    // Explicit Gemini API mode stops the SDK reading Vertex AI settings from the deployment.
    return createGeminiModel(configuration.modelId, configuration.apiKey, {
      vertexai: false,
      httpOptions: { baseUrl: configuration.baseUrl, fetch: configuration.fetch },
    })
  }
  if (configuration.providerType === "xai") {
    const createGrokModel = extendAdapter(createGrokText, models)
    return createGrokModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      organization: null,
      project: null,
    })
  }
  if (configuration.providerType === "openrouter") {
    return extendAdapter(createOpenRouterText, models)(
      configuration.modelId,
      configuration.apiKey,
      {
        serverURL: configuration.baseUrl,
        httpClient: new HTTPClient({ fetcher: configuration.fetch }),
      },
    )
  }
  return openaiCompatibleText(configuration.modelId, {
    apiKey: configuration.apiKey,
    baseURL: configuration.baseUrl,
    fetch: configuration.fetch,
    organization: null,
    project: null,
    api: configuration.api,
    name: configuration.providerName,
  })
}
