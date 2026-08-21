import { DEFAULT_ENDPOINT, DEFAULT_THEME } from "./lib/client-constants.ts"
import { createDebugLogger } from "./lib/client-utils.ts"
import type { AstralBeamChatHandle, MountAstralBeamChatOptions } from "./lib/client-types.ts"

export type {
  AstralBeamChatHandle,
  AstralBeamChatTheme,
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
  const debug = createDebugLogger(options.debug)
  // The `.dark` class on the container drives the palette and the Tailwind `dark:`
  // variant; light needs no class. `"system"` re-resolves on OS preference changes.
  let theme = options.theme ?? DEFAULT_THEME
  debug?.("mount", "mounting chat widget", {
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
    theme,
    systemPrompt: options.systemPrompt,
    tools: Object.keys(options.tools ?? {}),
    widgets: Object.keys(options.widgets ?? {}),
  })
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles.
  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  // The loader owns the widget container so theming works before the lazy chunk arrives.
  const container = document.createElement("div")
  container.style.height = "100%"
  shadowRoot.append(container)

  const systemDark = matchMedia("(prefers-color-scheme: dark)")
  const applyTheme = () => {
    const dark = theme === "dark" || (theme === "system" && systemDark.matches)
    container.classList.toggle("dark", dark)
    debug?.("theme", `theme "${theme}" resolved to ${dark ? "dark" : "light"}`)
  }
  applyTheme()
  systemDark.addEventListener("change", applyTheme)

  let unmounted = false
  let disposeChat: (() => void) | undefined
  import("./chat/index.tsx").then(({ renderChat }) => {
    debug?.("mount", "chat chunk loaded")
    if (!unmounted) disposeChat = renderChat(shadowRoot, container, options)
  })
  return {
    setTheme: (nextTheme) => {
      theme = nextTheme
      applyTheme()
    },
    unmount: () => {
      debug?.("mount", "unmounting chat widget")
      unmounted = true
      systemDark.removeEventListener("change", applyTheme)
      disposeChat?.()
      disposeChat = undefined
      container.remove()
    },
  }
}
