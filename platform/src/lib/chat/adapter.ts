import { createModel, extendAdapter } from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"
import { Schema } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

function outputTokenField(configuration: Pick<ChatModelConfiguration, "api" | "baseUrl">) {
  // Compatible gateways retain max_tokens. https://docs.ollama.com/api/openai-compatibility
  return configuration.api === "responses"
    ? "max_output_tokens"
    : configuration.api === "chat-completions" &&
        new URL(configuration.baseUrl).hostname === "api.openai.com"
      ? "max_completion_tokens"
      : "max_tokens"
}

export function modelOutputOptions(configuration: ChatModelConfiguration) {
  return { [outputTokenField(configuration)]: configuration.outputCap }
}

export function createChatAdapter(configuration: ChatModelConfiguration) {
  const decodeRequest = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        model: Schema.Literal(configuration.modelId),
        [outputTokenField(configuration)]: Schema.Int.check(
          Schema.isGreaterThan(0),
          Schema.isLessThanOrEqualTo(configuration.outputCap),
        ),
      }),
    ),
  )
  const boundedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input.clone() : input, init)
    decodeRequest(await request.text())
    return configuration.fetch(input, {
      ...init,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(600_000)]),
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
