import { createModel, extendAdapter } from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

export function modelOutputOptions(configuration: ChatModelConfiguration) {
  // Compatible gateways use max_tokens. https://docs.ollama.com/api/openai-compatibility
  const field =
    configuration.api === "responses"
      ? "max_output_tokens"
      : configuration.api === "chat-completions" &&
          new URL(configuration.baseUrl).hostname === "api.openai.com"
        ? "max_completion_tokens"
        : "max_tokens"
  return { [field]: configuration.outputCap }
}

export function createChatAdapter(configuration: ChatModelConfiguration) {
  const boundedFetch: typeof fetch = (input, init) => {
    const signals = [AbortSignal.timeout(600_000)]
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (callerSignal) signals.push(callerSignal)
    return configuration.fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
    })
  }
  if (configuration.providerType === "openai" && configuration.api === "responses") {
    const createOpenaiModel = extendAdapter(createOpenaiChat, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])
    // Null stops the SDK reading OPENAI_ORG_ID and OPENAI_PROJECT_ID from the deployment.
    return createOpenaiModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: boundedFetch,
      organization: null,
      project: null,
      maxRetries: 0,
    })
  }
  if (configuration.api === "anthropic-messages") {
    const createAnthropicModel = extendAdapter(createAnthropicChat, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])
    // Null stops the SDK sending a deployment ANTHROPIC_AUTH_TOKEN as a bearer header.
    return createAnthropicModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: boundedFetch,
      authToken: null,
      maxRetries: 0,
    })
  }
  return openaiCompatibleText(configuration.modelId, {
    apiKey: configuration.apiKey,
    baseURL: configuration.baseUrl,
    fetch: boundedFetch,
    organization: null,
    project: null,
    api: configuration.api,
    name: configuration.providerName,
    maxRetries: 0,
  })
}
