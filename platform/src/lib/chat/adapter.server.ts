import { createModel, extendAdapter } from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

export function createChatAdapter(configuration: ChatModelConfiguration) {
  if (configuration.providerType === "openai" && configuration.api === "responses") {
    const createOpenaiModel = extendAdapter(createOpenaiChat, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])
    // Null stops the SDK reading OPENAI_ORG_ID and OPENAI_PROJECT_ID from the deployment.
    return createOpenaiModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      organization: null,
      project: null,
    })
  }
  if (configuration.api === "anthropic-messages") {
    const createAnthropicModel = extendAdapter(createAnthropicChat, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])
    return createAnthropicModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
    })
  }
  return openaiCompatibleText(configuration.modelId, {
    apiKey: configuration.apiKey,
    baseURL: configuration.baseUrl,
    organization: null,
    project: null,
    api: configuration.api,
    name: configuration.providerName,
  })
}
