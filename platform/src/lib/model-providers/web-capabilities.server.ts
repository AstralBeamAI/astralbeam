import { OPENAI_CHAT_MODELS, type OpenAIChatModelToolCapabilitiesByName } from "@tanstack/ai-openai"
import {
  ANTHROPIC_MODELS,
  type AnthropicChatModelToolCapabilitiesByName,
} from "@tanstack/ai-anthropic"
import type { ChatModelConfiguration } from "./model-providers.server"

type ModelNamesWithoutSearch<Models extends { [Name in keyof Models]: readonly string[] }> = {
  [Name in keyof Models]: "web_search" extends Models[Name][number] ? never : Name
}[keyof Models]
// Adapter capabilities are type-only. These exhaustive maps are checked against installed metadata.
// https://github.com/TanStack/ai/blob/main/packages/ai-openai/src/model-meta.ts
const MODEL_OPENAI_WITHOUT_WEB: Record<
  ModelNamesWithoutSearch<OpenAIChatModelToolCapabilitiesByName>,
  true
> = {
  "gpt-5.1-codex": true,
  "gpt-5-codex": true,
  "gpt-audio": true,
  "gpt-audio-mini": true,
  "o1-pro": true,
  "computer-use-preview": true,
  "gpt-4o-mini-search-preview": true,
  "gpt-4o-search-preview": true,
  "gpt-4o-mini-audio": true,
  o1: true,
  "gpt-4o-audio": true,
  "gpt-4-turbo": true,
  "gpt-5.1-codex-mini": true,
  "codex-mini-latest": true,
  "gpt-3.5-turbo": true,
  "gpt-4": true,
  "gpt-6-astra-pro": true,
  "gpt-6-luna-pro": true,
  "gpt-6-sol-pro": true,
}
const MODEL_ANTHROPIC_WITHOUT_WEB: Record<
  ModelNamesWithoutSearch<AnthropicChatModelToolCapabilitiesByName>,
  true
> = { "claude-opus-5-fast": true }

export function modelWebCapabilities(
  model: Pick<ChatModelConfiguration, "providerType" | "api" | "modelId"> & { baseUrl?: string },
): { available: boolean | null; reason: string | null } {
  const endpoint =
    model.api === "anthropic-messages"
      ? "https://api.anthropic.com"
      : model.providerType === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "https://api.openai.com/v1"
  const knownEndpoint =
    model.baseUrl === undefined || new URL(model.baseUrl).href.replace(/\/+$/, "") === endpoint
  if (model.providerType === "openrouter" && model.api === "chat-completions")
    return { available: knownEndpoint ? true : null, reason: null }
  if (model.providerType === "openai" && model.api === "chat-completions")
    return {
      available: false,
      reason:
        "Web access requires OpenAI Responses. Select Responses for this connection in Models.",
    }
  if (
    knownEndpoint &&
    ((model.providerType === "openai" && Object.hasOwn(MODEL_OPENAI_WITHOUT_WEB, model.modelId)) ||
      (model.api === "anthropic-messages" &&
        Object.hasOwn(MODEL_ANTHROPIC_WITHOUT_WEB, model.modelId)))
  )
    return {
      available: false,
      reason:
        "The selected model does not support native web access. Select a web-capable model in Models.",
    }
  if (model.providerType === "openai" && model.api === "responses")
    return {
      available:
        knownEndpoint && OPENAI_CHAT_MODELS.some((name) => name === model.modelId) ? true : null,
      reason: null,
    }
  if (model.api === "anthropic-messages")
    return {
      available:
        knownEndpoint && ANTHROPIC_MODELS.some((name) => name === model.modelId) ? true : null,
      reason: null,
    }
  return {
    available: false,
    reason:
      "Web access requires OpenAI Responses, Anthropic Messages, or OpenRouter Chat Completions. Select a supported protocol in Models.",
  }
}
