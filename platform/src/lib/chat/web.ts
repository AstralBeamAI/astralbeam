import { webSearchTool as openaiSearch } from "@tanstack/ai-openai/tools"
import { grokWebSearchTool } from "@tanstack/ai-grok/tools"
import {
  webSearchTool as anthropicSearch,
  webFetchTool as anthropicFetch,
} from "@tanstack/ai-anthropic/tools"
import {
  webSearchTool as routerSearch,
  webFetchTool as routerFetch,
} from "@tanstack/ai-openrouter/tools"
import type { Tool } from "@tanstack/ai"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { modelWebAccess } from "@/lib/model-providers/web.server"
import { ChatWebAccessUnavailable } from "./errors"

export function chatWebTools(
  model: ChatModelConfiguration,
  enabled: boolean,
  browserTools: Tool[],
): Tool[] {
  if (!enabled) return []
  if (modelWebAccess(model) === false) throw new ChatWebAccessUnavailable()
  const tools =
    model.providerType === "openrouter"
      ? [routerSearch(), routerFetch()]
      : model.providerType === "xai"
        ? [grokWebSearchTool()]
        : model.api === "responses"
          ? [openaiSearch({ type: "web_search" })]
          : [
              anthropicSearch({ type: "web_search_20250305", name: "web_search", max_uses: 5 }),
              anthropicFetch({ max_uses: 5, citations: { enabled: true } }),
            ]
  if (
    browserTools.some((tool) =>
      [
        "web_search",
        "web_fetch",
        "openrouter:web_search",
        "openrouter:web_fetch",
        "web_access",
      ].includes(tool.name),
    )
  )
    throw new ChatWebAccessUnavailable()
  return tools
}
