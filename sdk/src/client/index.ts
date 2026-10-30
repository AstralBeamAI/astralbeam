import { applyWidgetTheme } from "../lib/theme.ts"
import {
  DEFAULT_API_URL,
  DEFAULT_COLOR_SCHEME,
  DEFAULT_EMPTY_DESCRIPTION,
  DEFAULT_EMPTY_HEADLINE,
  DEFAULT_TITLE,
  WIDGET_CONTAINER_CLASS,
} from "../lib/constants.ts"
import { createDebugLogger } from "../lib/debug.ts"
import type { AstralBeamChatHandle, MountAstralBeamChatOptions } from "../lib/types.ts"
// Type-only, so the chat chunk stays behind the dynamic import below.
import type { ChatHandle } from "../widget/index.tsx"

export type {
  AstralBeamChatAttachmentOptions,
  AstralBeamChatColorScheme,
  AstralBeamChatHandle,
  AstralBeamChatSlotRenderer,
  AstralBeamChatSlots,
  AstralBeamChatTheme,
  AstralBeamChatThemeVariables,
  AstralBeamChatUpdate,
  AstralBeamTokenRequest,
  AstralBeamTokenSource,
  InferParameters,
  JsonSchemaObject,
  MountAstralBeamChatOptions,
  ParametersSchema,
  StandardSchemaV1,
  ToolDefinition,
  WidgetDefinition,
} from "../lib/types.ts"
export { defineTool, defineWidget } from "../lib/define.ts"
export type { TypedToolDefinition, TypedWidgetDefinition } from "../lib/define.ts"
export {
  mountAstralBeamThreadList,
  mountAstralBeamTenantList,
  mountAstralBeamTenantUserList,
} from "./listings.ts"
export type {
  AstralBeamListingHandle,
  AstralBeamListingOptions,
  AstralBeamTenantListHandle,
  AstralBeamTenantUserListHandle,
  MountAstralBeamThreadListOptions,
  AstralBeamThreadListHandle,
  MountAstralBeamTenantListOptions,
  MountAstralBeamTenantUserListOptions,
} from "./listings.ts"

// Mounts the AstralBeam chat widget into `target`, inside a shadow root that isolates
// its styles. The React chat loads lazily, keeping this entry a tiny loader.
export function mountAstralBeamChat(
  target: HTMLElement,
  options: MountAstralBeamChatOptions,
): AstralBeamChatHandle {
  // The loader owns the live options, so an update that lands before the lazy chunk resolves is
  // already part of the options the widget first renders with.
  let live: MountAstralBeamChatOptions = { ...options }
  let debug = createDebugLogger(live.debug)
  debug?.("mount", "mounting chat widget", {
    agentId: live.agentId ?? "(organization default)",
    title: live.title ?? DEFAULT_TITLE,
    showHeader: live.showHeader ?? true,
    emptyHeadline: live.emptyHeadline ?? DEFAULT_EMPTY_HEADLINE,
    emptyDescription: live.emptyDescription ?? DEFAULT_EMPTY_DESCRIPTION,
    apiUrl: live.apiUrl ?? DEFAULT_API_URL,
    authentication: "configured",
    colorScheme: live.colorScheme ?? DEFAULT_COLOR_SCHEME,
    theme: live.theme,
    tools: Object.keys(live.tools ?? {}),
    widgets: Object.keys(live.widgets ?? {}),
    attachments: live.attachments ?? true,
  })
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles.
  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  // The loader owns the widget container so theming works before the lazy chunk arrives.
  const container = document.createElement("div")
  container.className = WIDGET_CONTAINER_CLASS
  container.style.height = "100%"
  shadowRoot.append(container)
  // This feedback must paint before the lazy widget and its stylesheet arrive.
  const loading = document.createElement("div")
  loading.dataset.slot = "chat-loading"
  const style = document.createElement("style")
  style.textContent = `
    [data-slot="chat-loading"] {
      position: relative; display: grid; place-items: center; height: 100%; color-scheme: light;
      background: var(--background, light-dark(#fff, #171717));
      color: var(--foreground, light-dark(#171717, #fafafa));
      font: 14px/1.5 var(--font-sans, system-ui, sans-serif);
    }
    .dark [data-slot="chat-loading"] { color-scheme: dark; }
    [data-slot="chat-loading-close"] {
      position: absolute; inset-block-start: 14px; inset-inline-end: 12px;
      width: 28px; height: 28px; padding: 0; font: 20px/1 var(--font-sans, system-ui, sans-serif);
      border: 0; border-radius: var(--radius-sm, 4px); background: transparent;
      color: inherit; cursor: pointer;
    }
    [data-slot="chat-loading-close"]:hover {
      background: var(--accent, color-mix(in srgb, currentColor 8%, transparent));
    }
    [data-slot="chat-loading-close"]:focus-visible {
      outline: 2px solid var(--ring, currentColor); outline-offset: 2px;
    }
    [data-slot="chat-loading-close"]::after {
      content: attr(aria-label); display: none; position: absolute;
      inset-block-start: calc(100% + 6px); inset-inline-end: 0; padding: 4px 8px;
      background: var(--foreground, light-dark(#171717, #fafafa));
      color: var(--background, light-dark(#fff, #171717));
      font: 12px/1.5 var(--font-sans, system-ui, sans-serif); white-space: nowrap; pointer-events: none;
    }
    [data-slot="chat-loading-close"]:is(:hover, :focus-visible)::after { display: block; }
    [data-slot="chat-loading-status"] {
      display: flex; align-items: center; gap: 8px; padding: 24px;
      color: var(--muted-foreground, inherit);
    }
    [data-slot="chat-loading-status"][data-loading]::before {
      content: "";
      box-sizing: border-box; width: 16px; height: 16px; flex-shrink: 0;
      border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
      animation: astralbeam-loading-spin 0.8s linear infinite;
    }
    @keyframes astralbeam-loading-spin { to { transform: rotate(360deg); } }
    @media (any-pointer: coarse) {
      [data-slot="chat-loading-close"] { inset-block-start: 6px; width: 44px; height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-slot="chat-loading-status"][data-loading]::before { animation: none; }
    }
  `
  const close = document.createElement("button")
  close.dataset.slot = "chat-loading-close"
  close.type = "button"
  close.setAttribute("aria-label", "Close chat")
  close.textContent = "×"
  close.hidden = !live.onClose
  const status = document.createElement("div")
  status.dataset.slot = "chat-loading-status"
  status.dataset.loading = ""
  status.setAttribute("role", "status")
  status.textContent = "Loading chat…"
  loading.append(style, close, status)
  close.onclick = (event) => {
    if (event.detail < 2) live.onClose?.()
  }
  container.append(loading)

  const systemDark = matchMedia("(prefers-color-scheme: dark)")
  // Inline custom properties on the container override the sheet's `:host`/`.dark` blocks by
  // inheritance; `setProperty` keeps host-supplied names and values out of parsed CSS text.
  const appliedVariables = new Set<string>()
  // The `.dark` class on the container drives the palette and the Tailwind `dark:` variant; light
  // needs no class. `"system"` re-resolves on OS preference changes.
  const applyTheme = () => {
    const { colorScheme, dark } = applyWidgetTheme(
      container,
      appliedVariables,
      live,
      systemDark.matches,
    )
    debug?.("theme", `color scheme "${colorScheme}" resolved to ${dark ? "dark" : "light"}`, {
      themeVariables: [...appliedVariables],
    })
  }
  applyTheme()
  systemDark.addEventListener("change", applyTheme)

  let unmounted = false
  let chat: ChatHandle | undefined
  void import("../widget/index.tsx")
    .then(({ renderChat }) => {
      debug?.("mount", "chat chunk loaded")
      if (!unmounted) chat = renderChat(shadowRoot, container, live)
    })
    .catch(() => {
      if (!unmounted) {
        delete status.dataset.loading
        status.textContent = "Could not load chat. Reload this page to try again."
      }
    })
  return {
    update: (next) => {
      // A fresh object rather than a mutation, so the widget's memoized derivations compare the
      // new option values by identity instead of seeing the same object twice.
      live = { ...live, ...next }
      debug = createDebugLogger(live.debug)
      debug?.("mount", "options updated", { changed: Object.keys(next) })
      applyTheme()
      close.hidden = !live.onClose
      chat?.update(live)
    },
    // No-ops until the lazy chunk resolves: with no chat there is nothing to reset or stop.
    reset: () => chat?.reset(),
    stop: () => chat?.stop(),
    unmount: () => {
      debug?.("mount", "unmounting chat widget")
      unmounted = true
      systemDark.removeEventListener("change", applyTheme)
      chat?.dispose()
      chat = undefined
      container.remove()
    },
  }
}

export { mountAstralBeamMcpServers } from "./mcp-servers.ts"
export type {
  AstralBeamMcpServersHandle,
  MountAstralBeamMcpServersOptions,
  McpServerInput,
  McpServerItem,
  McpServerFormError,
} from "./mcp-servers.ts"
