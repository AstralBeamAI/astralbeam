import { WIDGET_CONTAINER_CLASS } from "../lib/constants.ts"
import { applyWidgetTheme } from "../lib/theme.ts"
import type { AstralBeamChatColorScheme, AstralBeamChatTheme } from "../lib/types.ts"
import type { renderMcpServers } from "../widget/mcp-servers.tsx"

export interface McpServerInput {
  endpointUrl: string
  authConfig:
    | { kind: "none" }
    | { kind: "static_headers"; headerNames: readonly string[] }
    | {
        kind: "oauth"
        profile: "standard" | "google"
        applicationOrigin?: string
        requestedScopes: readonly string[]
        client?: { clientId: string; clientSecret?: string }
      }
}

export interface McpServerItem {
  id: string
  endpointUrl: string
  authKind: McpServerInput["authConfig"]["kind"] | null
}

export interface McpServerFormError {
  field: string
  message: string
}

export interface MountAstralBeamMcpServersOptions {
  servers: readonly McpServerItem[]
  oauthRedirectUri?: string | null | undefined
  /** Host callbacks authorize writes and refresh servers. Omit them for a read-only list. */
  onCreateServer?:
    | ((input: McpServerInput) => Promise<void | { errors: readonly McpServerFormError[] }>)
    | undefined
  onRemoveServer?: ((id: string) => Promise<void>) | undefined
  colorScheme?: AstralBeamChatColorScheme | undefined
  theme?: AstralBeamChatTheme | undefined
}

export interface AstralBeamMcpServersHandle {
  update(options: Partial<MountAstralBeamMcpServersOptions>): void
  unmount(): void
}

/** Unmount when the host's authenticated identity or management scope changes. */
export function mountAstralBeamMcpServers(
  target: HTMLElement,
  options: MountAstralBeamMcpServersOptions,
): AstralBeamMcpServersHandle {
  const shadow = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  const container = document.createElement("div")
  container.className = WIDGET_CONTAINER_CLASS
  shadow.append(container)
  const media = matchMedia("(prefers-color-scheme: dark)")
  const variables = new Set<string>()
  let live = options
  let disposed = false
  let renderer: ReturnType<typeof renderMcpServers> | undefined
  const theme = () => applyWidgetTheme(container, variables, live, media.matches)
  theme()
  media.addEventListener("change", theme)
  const load = async () => {
    container.replaceChildren()
    try {
      const { renderMcpServers } = await import("../widget/mcp-servers.tsx")
      if (!disposed) renderer = renderMcpServers(container, live)
    } catch {
      if (disposed) return
      const retry = document.createElement("button")
      retry.textContent = "Could not load MCP servers. Retry"
      retry.onclick = () => void load()
      container.replaceChildren(retry)
    }
  }
  void load()
  return {
    update(next) {
      if (disposed) return
      live = { ...live, ...next }
      theme()
      renderer?.update(live)
    },
    unmount() {
      disposed = true
      media.removeEventListener("change", theme)
      renderer?.unmount()
      container.remove()
    },
  }
}
