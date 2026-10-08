import { createModel, extendAdapter } from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"
import { createOpenRouterText } from "@tanstack/ai-openrouter"
import { HTTPClient } from "@openrouter/sdk/lib/http.js"
import { Schema } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

export function modelOutputOptions(
  configuration: Pick<ChatModelConfiguration, "api" | "providerType">,
  outputCap: number,
) {
  return configuration.api === "responses"
    ? { max_output_tokens: outputCap }
    : configuration.providerType === "openrouter"
      ? { maxCompletionTokens: outputCap }
      : configuration.api === "anthropic-messages"
        ? { max_tokens: outputCap }
        : { max_completion_tokens: outputCap }
}

export function createChatAdapter(configuration: ChatModelConfiguration) {
  const capField =
    configuration.api === "responses"
      ? "max_output_tokens"
      : configuration.api === "anthropic-messages"
        ? "max_tokens"
        : "max_completion_tokens"
  const decodeRequest = Schema.decodeUnknownSync(
    Schema.Struct({
      model: Schema.Literal(configuration.modelId),
      [capField]: Schema.Int.check(
        Schema.isGreaterThan(0),
        Schema.isLessThanOrEqualTo(configuration.usageConfiguration.outputCap),
      ),
    }),
  )
  const boundedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input.clone() : input, init)
    decodeRequest(JSON.parse(await request.text()))
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
  if (configuration.providerType === "openrouter") {
    const createOpenRouterModel = extendAdapter(createOpenRouterText, [
      createModel(configuration.modelId, ["text", "image"]),
    ])
    return createOpenRouterModel(configuration.modelId, configuration.apiKey, {
      serverURL: configuration.baseUrl,
      httpClient: new HTTPClient({ fetcher: boundedFetch }),
      retryConfig: { strategy: "none" },
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
