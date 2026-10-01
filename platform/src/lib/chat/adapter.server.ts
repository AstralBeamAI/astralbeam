import { createModel, extendAdapter } from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

export function createChatAdapter(configuration: ChatModelConfiguration) {
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
    api: configuration.api,
    name: configuration.providerName,
  })
}
