import {
  DEFAULT_COLOR_SCHEME,
  DEFAULT_ENDPOINT,
  DEFAULT_TITLE,
  WIDGET_CONTAINER_CLASS,
} from "./lib/client-constants.ts"
import { createDebugLogger } from "./lib/client-utils.ts"
import type { AstralBeamChatHandle, MountAstralBeamChatOptions } from "./lib/client-types.ts"
// Type-only, so the chat chunk stays behind the dynamic import below.
import type { ChatHandle } from "./chat/index.tsx"

export type {
  AstralBeamChatAttachmentOptions,
  AstralBeamChatColorScheme,
  AstralBeamChatHandle,
  AstralBeamChatTheme,
  AstralBeamChatThemeVariables,
  AstralBeamChatUpdate,
  JsonSchemaObject,
  MountAstralBeamChatOptions,
  ParametersSchema,
  StandardSchemaV1,
  ToolDefinition,
  WidgetDefinition,
} from "./lib/client-types.ts"

// Mounts the AstralBeam chat widget into `target`, inside a shadow root that isolates
// its styles. The React chat loads lazily, keeping this entry a tiny loader.
export function mountAstralBeamChat(
  target: HTMLElement,
  options: MountAstralBeamChatOptions = {},
): AstralBeamChatHandle {
  // The loader owns the live options, so an update that lands before the lazy chunk resolves is
  // already part of the options the widget first renders with.
  let live: MountAstralBeamChatOptions = { ...options }
  let debug = createDebugLogger(live.debug)
  debug?.("mount", "mounting chat widget", {
    title: live.title ?? DEFAULT_TITLE,
    chatEndpoint: live.chatEndpoint ?? DEFAULT_ENDPOINT,
    authentication: live.authEndpoint ? "configured" : "guest",
    colorScheme: live.colorScheme ?? DEFAULT_COLOR_SCHEME,
    theme: live.theme,
    systemPrompt: live.systemPrompt,
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

  const systemDark = matchMedia("(prefers-color-scheme: dark)")
  // Inline custom properties on the container override the sheet's `:host`/`.dark` blocks by
  // inheritance; `setProperty` keeps host-supplied names and values out of parsed CSS text.
  const appliedVariables = new Set<string>()
  const applyThemeVariables = (dark: boolean) => {
    for (const name of appliedVariables) container.style.removeProperty(name)
    appliedVariables.clear()
    // Mirrors shadcn's `:root`/`.dark` split: `light` is the base for both schemes.
    const overrides = { ...live.theme?.light, ...(dark ? live.theme?.dark : undefined) }
    for (const [name, value] of Object.entries(overrides)) {
      if (!name.startsWith("--")) continue
      container.style.setProperty(name, value)
      appliedVariables.add(name)
    }
  }
  // The `.dark` class on the container drives the palette and the Tailwind `dark:` variant; light
  // needs no class. `"system"` re-resolves on OS preference changes.
  const applyTheme = () => {
    const colorScheme = live.colorScheme ?? DEFAULT_COLOR_SCHEME
    const dark = colorScheme === "dark" || (colorScheme === "system" && systemDark.matches)
    container.classList.toggle("dark", dark)
    applyThemeVariables(dark)
    debug?.("theme", `color scheme "${colorScheme}" resolved to ${dark ? "dark" : "light"}`, {
      themeVariables: [...appliedVariables],
    })
  }
  applyTheme()
  systemDark.addEventListener("change", applyTheme)

  let unmounted = false
  let chat: ChatHandle | undefined
  import("./chat/index.tsx").then(({ renderChat }) => {
    debug?.("mount", "chat chunk loaded")
    if (!unmounted) chat = renderChat(shadowRoot, container, live)
  })
  return {
    update: (next) => {
      // A fresh object rather than a mutation, so the widget's memoized derivations compare the
      // new option values by identity instead of seeing the same object twice.
      live = { ...live, ...next }
      debug = createDebugLogger(live.debug)
      debug?.("mount", "options updated", { changed: Object.keys(next) })
      applyTheme()
      chat?.update(live)
    },
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
