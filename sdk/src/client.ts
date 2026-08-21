import { DEFAULT_ENDPOINT } from "./lib/constants.ts"
import { createDebugLogger } from "./lib/debug.ts"

// Minimal Standard Schema interface, vendored as the spec suggests: just enough to
// accept any spec-compliant validator (Zod, Valibot, ArkType, ...) without a dependency.
export interface StandardSchemaV1 {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => unknown
  }
}

/** A plain JSON Schema object, the same shape tool definitions use for their parameters. */
export interface JsonSchemaObject {
  type: "object"
  properties?: Record<string, unknown>
  required?: string[]
  [keyword: string]: unknown
}

/** Schema of the input the agent supplies to a widget or tool, like a tool definition's parameters. */
export type ParametersSchema = StandardSchemaV1 | JsonSchemaObject

export interface WidgetDefinition {
  /** Tells the agent what the widget shows so it can decide when to render it. */
  description: string
  /**
   * Forwarded to the agent as JSON Schema. Only a Standard Schema also validates the
   * props before `render` runs; with a plain JSON Schema, treat the props as untrusted.
   */
  parameters?: ParametersSchema
  /**
   * Draws the widget with the agent-chosen props into `container`, a light-DOM child of
   * the mount target. May return a cleanup, called before a re-render and on unmount.
   */
  render: (props: Record<string, unknown>, container: HTMLElement) => (() => void) | void
}

export interface ToolDefinition {
  /** Tells the agent what the tool does so it can decide when to call it. */
  description: string
  /**
   * Forwarded to the agent as JSON Schema. Only a Standard Schema also validates the
   * input before `execute` runs; with a plain JSON Schema, treat the input as untrusted.
   */
  parameters?: ParametersSchema
  /**
   * Runs in the host page with the agent-chosen input. The resolved value is returned
   * to the agent as the tool result; a thrown error is returned as a tool error.
   */
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>
}

/** Color scheme of the chat widget; `"system"` follows the OS `prefers-color-scheme` setting. */
export type AstralBeamChatTheme = "light" | "dark" | "system"

export interface MountAstralBeamChatOptions {
  /** URL of the AstralBeam chat endpoint the widget streams from. Default `"/api/chat"`. */
  endpoint?: string | undefined
  /** Host-specific instructions the endpoint appends to the agent's system prompt. */
  systemPrompt?: string | undefined
  /** Host-defined tools the agent can call, executed in the host page, keyed by tool name. */
  tools?: Record<string, ToolDefinition> | undefined
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
  /** Initial color scheme; change it after mount with the handle's `setTheme`. Default `"system"`. */
  theme?: AstralBeamChatTheme
  /**
   * Logs every SDK action to the browser console with UTC timestamps and full payloads,
   * and asks the endpoint (via the forwarded props) to log its side of the run too.
   */
  debug?: boolean | undefined
}

export interface AstralBeamChatHandle {
  unmount: () => void
  /** Switches the widget's color scheme, e.g. when the host app's own theme toggles. */
  setTheme: (theme: AstralBeamChatTheme) => void
}

// Mounts the AstralBeam chat widget into `target`, inside a shadow root that isolates
// its styles. The React chat loads lazily, keeping this entry a tiny loader.
export function mountAstralBeamChat(
  target: HTMLElement,
  options: MountAstralBeamChatOptions = {},
): AstralBeamChatHandle {
  const debug = createDebugLogger(options.debug)
  debug?.("mount", "mounting chat widget", {
    endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
    theme: options.theme ?? "system",
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

  // The `.dark` class on the container drives the palette and the Tailwind `dark:`
  // variant; light needs no class. `"system"` re-resolves on OS preference changes.
  let theme = options.theme ?? "system"
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
