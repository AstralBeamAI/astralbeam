import {
  DEFAULT_ENDPOINT,
  DEFAULT_THEME,
  DEFAULT_TITLE,
  WIDGET_CONTAINER_CLASS,
} from "./lib/client-constants.ts"
import { createDebugLogger } from "./lib/client-utils.ts"
import type { AstralBeamChatHandle, MountAstralBeamChatOptions } from "./lib/client-types.ts"
// Type-only, so the chat chunk stays behind the dynamic import below.
import type { ChatHandle } from "./chat/index.tsx"

export type {
  AstralBeamChatHandle,
  AstralBeamChatTheme,
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
    endpoint: live.endpoint ?? DEFAULT_ENDPOINT,
    theme: live.theme ?? DEFAULT_THEME,
    systemPrompt: live.systemPrompt,
    tools: Object.keys(live.tools ?? {}),
    widgets: Object.keys(live.widgets ?? {}),
  })
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles.
  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  // The loader owns the widget container so theming works before the lazy chunk arrives.
  const container = document.createElement("div")
  container.className = WIDGET_CONTAINER_CLASS
  container.style.height = "100%"
  shadowRoot.append(container)

  const systemDark = matchMedia("(prefers-color-scheme: dark)")
  // The `.dark` class on the container drives the palette and the Tailwind `dark:` variant; light
  // needs no class. `"system"` re-resolves on OS preference changes.
  const applyTheme = () => {
    const theme = live.theme ?? DEFAULT_THEME
    const dark = theme === "dark" || (theme === "system" && systemDark.matches)
    container.classList.toggle("dark", dark)
    debug?.("theme", `theme "${theme}" resolved to ${dark ? "dark" : "light"}`)
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
