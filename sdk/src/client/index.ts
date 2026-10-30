import { chatStyles, chatIcons } from "../widget/styles.generated.ts"
import { applyWidgetTheme } from "../lib/theme.ts"
import {
  CHAT_PANEL_CLASS_NAME,
  CHAT_HEADER_CLASS_NAME,
  CHAT_FOOTER_CLASS_NAME,
  CHAT_COMPOSER_SHORTCUT,
  CHAT_INPUT_CLASS_NAME,
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
  const style = document.createElement("style")
  style.textContent = chatStyles + (live.customCss ?? "")
  shadowRoot.append(style)
  const loading = document.createElement("div")
  loading.dataset.slot = "chat-loading"
  loading.className = CHAT_PANEL_CLASS_NAME
  loading.innerHTML = `
    <div data-slot="card-header" class="${CHAT_HEADER_CLASS_NAME}">
      <span data-slot="chat-loading-title" class="min-w-0 truncate pe-12 font-heading text-base font-medium"></span>
    </div>
    <button data-slot="chat-loading-close" type="button" aria-label="Close chat" class="absolute end-3 top-3.5 inline-flex size-7 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring any-pointer-coarse:top-1.5 any-pointer-coarse:size-11">${chatIcons.close}</button>
    <div data-slot="chat-loading-status" role="status" data-loading class="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground"><span class="animate-spin motion-reduce:animate-none">${chatIcons.loading}</span>Loading chat…</div>
    <div class="${CHAT_FOOTER_CLASS_NAME}">
      <div class="w-full">
        <div data-slot="chat-loading-composer" class="flex flex-col rounded-lg border border-input bg-input/50 opacity-50 dark:bg-input/80">
          <textarea aria-label="Message" rows="1" disabled class="w-full resize-none border-0 bg-transparent px-2.5 text-sm text-foreground placeholder:text-muted-foreground ${CHAT_INPUT_CLASS_NAME}"></textarea>
          <div class="flex px-2.5 pb-1">
            <button type="button" aria-label="Attach files" disabled class="inline-flex size-8 items-center justify-center rounded-lg opacity-50 any-pointer-coarse:size-11">${chatIcons.attach}</button>
            <button type="button" aria-label="Send" disabled class="ms-auto inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground opacity-50 any-pointer-coarse:size-11">${chatIcons.send}</button>
          </div>
        </div>
        <p class="mt-1 text-center text-xs text-muted-foreground">${CHAT_COMPOSER_SHORTCUT} AI can make mistakes.</p>
      </div>
    </div>
  `
  container.append(loading)
  const header = loading.querySelector<HTMLElement>('[data-slot="card-header"]')!
  const loadingTitle = loading.querySelector<HTMLElement>('[data-slot="chat-loading-title"]')!
  const close = loading.querySelector<HTMLButtonElement>('[data-slot="chat-loading-close"]')!
  const status = loading.querySelector<HTMLElement>('[role="status"]')!
  const input = loading.querySelector("textarea")!
  const attach = loading.querySelector<HTMLButtonElement>('[aria-label="Attach files"]')!
  const updateLoading = () => {
    loadingTitle.textContent = live.title ?? DEFAULT_TITLE
    header.hidden = live.showHeader === false
    input.placeholder = `Message ${live.title ?? DEFAULT_TITLE}…`
    attach.hidden =
      live.attachments === false ||
      (typeof live.attachments === "object" && live.attachments.enabled === false)
    close.hidden = !live.onClose
  }
  updateLoading()
  close.onclick = (event) => {
    if (event.detail < 2) live.onClose?.()
  }

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
      if ("customCss" in next && next.customCss !== live.customCss) {
        style.textContent = chatStyles + (next.customCss ?? "")
      }
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
      style.remove()
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
