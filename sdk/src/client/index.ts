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
      position: relative; display: flex; flex-direction: column; height: 100%; color-scheme: light;
      background: var(--background, light-dark(#fff, #171717));
      color: var(--foreground, light-dark(#171717, #fafafa));
      font: 14px/1.5 var(--font-sans, system-ui, sans-serif);
    }
    .dark [data-slot="chat-loading"] { color-scheme: dark; }
    [data-slot="chat-loading-title"] {
      box-sizing: border-box; height: 56px; flex-shrink: 0; padding-inline: 12px 64px;
      border-bottom: 1px solid var(--border, color-mix(in srgb, currentColor 14%, transparent));
      font: 500 16px/56px var(--font-heading, var(--font-sans, system-ui, sans-serif));
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
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
      display: flex; flex: 1; align-items: center; justify-content: center; gap: 8px; padding: 24px;
      color: var(--muted-foreground, inherit);
    }
    [data-slot="chat-loading-status"][data-loading]::before {
      content: "";
      box-sizing: border-box; width: 16px; height: 16px; flex-shrink: 0;
      border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
      animation: astralbeam-loading-spin 0.8s linear infinite;
    }
    [data-slot="chat-loading-footer"] { flex-shrink: 0; padding: 4px 12px 8px; }
    [data-slot="chat-loading-composer"] {
      border: 1px solid var(--input, color-mix(in srgb, currentColor 14%, transparent));
      border-radius: var(--radius, 10px); opacity: 0.5;
      background: color-mix(in srgb, var(--input, light-dark(#e5e5e5, #ffffff26)) 50%, transparent);
    }
    [data-slot="chat-loading-composer"] textarea {
      display: block; box-sizing: border-box; width: 100%; min-height: 32px; resize: none;
      border: 0; padding: 6px 10px; background: transparent; color: inherit; font: inherit; line-height: 20px;
    }
    [data-slot="chat-loading-composer"] textarea::placeholder { color: var(--muted-foreground, inherit); }
    [data-slot="chat-loading-actions"] { display: flex; padding: 0 10px 4px; }
    [data-slot="chat-loading-actions"] button {
      display: grid; place-items: center; width: 32px; height: 32px; padding: 0; opacity: 0.5;
      border: 0; border-radius: var(--radius, 10px); background: transparent; color: inherit;
    }
    [data-slot="chat-loading-actions"] button:last-child {
      margin-inline-start: auto; background: var(--primary, light-dark(#262626, #ebebeb));
      color: var(--primary-foreground, light-dark(#fafafa, #171717));
    }
    [data-slot="chat-loading-footer"] p {
      margin: 4px 0 0; text-align: center; font-size: 12px; line-height: 16px;
      color: var(--muted-foreground, inherit);
    }
    [data-slot="chat-loading"] [hidden] { display: none; }
    @keyframes astralbeam-loading-spin { to { transform: rotate(360deg); } }
    @media (any-pointer: coarse) {
      [data-slot="chat-loading-close"] { inset-block-start: 6px; width: 44px; height: 44px; }
      [data-slot="chat-loading-composer"] textarea { font-size: 16px; line-height: 24px; }
      [data-slot="chat-loading-actions"] button { width: 44px; height: 44px; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-slot="chat-loading-status"][data-loading]::before { animation: none; }
    }
  `
  const loadingTitle = document.createElement("span")
  loadingTitle.dataset.slot = "chat-loading-title"
  const close = document.createElement("button")
  close.dataset.slot = "chat-loading-close"
  close.type = "button"
  close.setAttribute("aria-label", "Close chat")
  close.textContent = "×"
  const status = document.createElement("div")
  status.dataset.slot = "chat-loading-status"
  status.dataset.loading = ""
  status.setAttribute("role", "status")
  status.textContent = "Loading chat…"
  const footer = document.createElement("div")
  footer.dataset.slot = "chat-loading-footer"
  // Static markup and Phosphor icons without pulling React into the loader.
  footer.innerHTML = `
    <div data-slot="chat-loading-composer">
      <textarea aria-label="Message" rows="1" disabled></textarea>
      <div data-slot="chat-loading-actions">
        <button type="button" aria-label="Attach files" disabled><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z"/></svg></button>
        <button type="button" aria-label="Send" disabled><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z"/></svg></button>
      </div>
    </div>
    <p>Enter to send, Shift+Enter for a new line. AI can make mistakes.</p>
  `
  const input = footer.querySelector("textarea")!
  const attach = footer.querySelector("button")!
  const updateLoading = () => {
    loadingTitle.textContent = live.title ?? DEFAULT_TITLE
    loadingTitle.hidden = live.showHeader === false
    input.placeholder = `Message ${live.title ?? DEFAULT_TITLE}…`
    attach.hidden =
      live.attachments === false ||
      (typeof live.attachments === "object" && live.attachments.enabled === false)
    close.hidden = !live.onClose
  }
  updateLoading()
  loading.append(style, loadingTitle, close, status, footer)
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
      updateLoading()
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
