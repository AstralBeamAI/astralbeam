import { OPENAI_CHAT_MODELS, type OpenAIChatModelToolCapabilitiesByName } from "@tanstack/ai-openai"
import { ANTHROPIC_MODELS } from "@tanstack/ai-anthropic"
import { GROK_CHAT_MODELS } from "@tanstack/ai-grok"
import { OPENROUTER_CHAT_MODELS } from "@tanstack/ai-openrouter/model-meta"
import type { ChatModelConfiguration } from "./model-providers.server"

type WithoutWeb<Models extends { [Name in keyof Models]: readonly string[] }> = {
  [Name in keyof Models]: "web_search" extends Models[Name][number] ? never : Name
}[keyof Models]

// Runtime exclusions are checked against the adapter's type-only capability metadata.
// https://github.com/TanStack/ai/blob/main/packages/ai-openai/src/model-meta.ts
const modelsWithoutWeb: Record<WithoutWeb<OpenAIChatModelToolCapabilitiesByName>, true> = {
  "gpt-5.1-codex": true,
  "gpt-5-codex": true,
  "gpt-audio": true,
  "gpt-audio-mini": true,
  "o1-pro": true,
  "gpt-4o-mini-search-preview": true,
  "gpt-4o-search-preview": true,
  o1: true,
  "gpt-4-turbo": true,
  "gpt-5.1-codex-mini": true,
  "gpt-3.5-turbo": true,
  "gpt-4": true,
  "gpt-6-astra-pro": true,
  "gpt-6-luna-pro": true,
  "gpt-6-sol-pro": true,
}

export function modelWebAccess(
  model: Pick<ChatModelConfiguration, "providerType" | "api" | "modelId" | "baseUrl">,
): boolean | null {
  const vendor =
    model.providerType === "openrouter" && model.api === "chat-completions"
      ? { endpoint: "https://openrouter.ai/api/v1", models: OPENROUTER_CHAT_MODELS }
      : model.api === "anthropic-messages"
        ? { endpoint: "https://api.anthropic.com", models: ANTHROPIC_MODELS }
        : model.providerType === "openai" && model.api === "responses"
          ? { endpoint: "https://api.openai.com/v1", models: OPENAI_CHAT_MODELS }
          : model.providerType === "xai"
            ? // The adapter lists no tools for Grok 4.5 and later, but xAI's web search guide uses grok-4.7.
              // https://docs.x.ai/docs/guides/tools/search-tools
              { endpoint: "https://api.x.ai/v1", models: GROK_CHAT_MODELS }
            : null
  if (!vendor) return false
  if (model.baseUrl.replace(/\/+$/, "") !== vendor.endpoint) return null
  if (model.providerType !== "openrouter" && Object.hasOwn(modelsWithoutWeb, model.modelId))
    return false
  return vendor.models.some((name) => name === model.modelId) ? true : null
}
