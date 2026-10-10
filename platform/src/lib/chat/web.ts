import { type Tool } from "@tanstack/ai"
import { webSearchTool as openaiWebSearch } from "@tanstack/ai-openai/tools"
import {
  webSearchTool as anthropicWebSearch,
  webFetchTool as anthropicWebFetch,
} from "@tanstack/ai-anthropic/tools"
import {
  webSearchTool as openrouterWebSearch,
  webFetchTool as openrouterWebFetch,
} from "@tanstack/ai-openrouter/tools"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { ChatWebAccessUnavailable } from "./errors"
import { modelWebCapabilities } from "@/lib/model-providers/web-capabilities.server"

const CHAT_RESERVED_WEB_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "web_search_preview",
  "openrouter:web_search",
  "openrouter:web_fetch",
])

/** Native declarations stay provider-owned. Browser declarations cannot substitute implementations. */
export function chatWebTools(
  model: ChatModelConfiguration,
  enabled: boolean,
  clientTools: readonly { name: string }[],
): Tool[] {
  if (!enabled) return []
  if (clientTools.some((tool) => CHAT_RESERVED_WEB_TOOLS.has(tool.name)))
    throw new ChatWebAccessUnavailable({
      reason: "Web tool names are reserved. Rename the application's web_search or web_fetch tool.",
    })
  const { reason } = modelWebCapabilities(model)
  if (reason) throw new ChatWebAccessUnavailable({ reason })
  if (model.providerType === "openrouter" && model.api === "chat-completions")
    return [openrouterWebSearch(), openrouterWebFetch()]
  if (model.providerType === "openai" && model.api === "responses")
    return [openaiWebSearch({ type: "web_search" })]
  return [
    anthropicWebSearch({ type: "web_search_20250305", name: "web_search", max_uses: 5 }),
    anthropicWebFetch({ max_uses: 5, citations: { enabled: true } }),
  ]
}
