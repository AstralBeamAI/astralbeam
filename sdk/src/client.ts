/**
 * Minimal [Standard Schema](https://standardschema.dev) interface, vendored as the spec suggests:
 * just enough to accept any spec-compliant validator (Zod, Valibot, ArkType, ...) without
 * depending on one.
 */
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

/** Schema of the props the agent supplies to a widget, like a tool definition's parameters. */
export type WidgetParameters = StandardSchemaV1 | JsonSchemaObject

export interface WidgetDefinition {
  /** Tells the agent what the widget shows so it can decide when to render it. */
  description: string
  /**
   * Schema of the agent-supplied props; passed to the agent verbatim. A Standard Schema also
   * validates the props before `render` runs; a plain JSON Schema does not, so treat the props
   * as untrusted input.
   */
  parameters?: WidgetParameters
  /**
   * Draws the widget with the agent-chosen props into `container`, a light-DOM child of the mount
   * target that the chat projects into the conversation. May return a cleanup function, called
   * before the widget is rendered again and when the chat unmounts.
   */
  render: (props: Record<string, unknown>, container: HTMLElement) => (() => void) | void
}

/** Color scheme of the chat widget; `"system"` follows the OS `prefers-color-scheme` setting. */
export type AstralBeamChatTheme = "light" | "dark" | "system"

export interface MountAstralBeamChatOptions {
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
  /** Initial color scheme; change it after mount with the handle's `setTheme`. Default `"system"`. */
  theme?: AstralBeamChatTheme
}

export interface AstralBeamChatHandle {
  unmount: () => void
  /** Switches the widget's color scheme, e.g. when the host app's own theme toggles. */
  setTheme: (theme: AstralBeamChatTheme) => void
}

/**
 * Mounts the AstralBeam chat widget into `target`, inside a shadow root that isolates its styles.
 * The React chat loads lazily, so this entry point stays a tiny framework-agnostic loader.
 */
export function mountAstralBeamChat(
  target: HTMLElement,
  options: MountAstralBeamChatOptions = {},
): AstralBeamChatHandle {
  // attachShadow throws when called twice, so reuse the root across mount/unmount cycles.
  const shadowRoot = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  // The loader owns the widget container so theming works before the lazy chat chunk arrives.
  const container = document.createElement("div")
  container.style.height = "100%"
  shadowRoot.append(container)

  // The `.dark` class on the container drives the palette and the Tailwind `dark:` variant in the
  // stylesheet; light needs no class. `"system"` re-resolves whenever the OS preference changes.
  let theme = options.theme ?? "system"
  const systemDark = matchMedia("(prefers-color-scheme: dark)")
  const applyTheme = () => {
    container.classList.toggle(
      "dark",
      theme === "dark" || (theme === "system" && systemDark.matches),
    )
  }
  applyTheme()
  systemDark.addEventListener("change", applyTheme)

  let unmounted = false
  let disposeChat: (() => void) | undefined
  import("./chat/index.tsx").then(({ renderChat }) => {
    if (!unmounted) disposeChat = renderChat(shadowRoot, container, options)
  })
  return {
    setTheme: (nextTheme) => {
      theme = nextTheme
      applyTheme()
    },
    unmount: () => {
      unmounted = true
      systemDark.removeEventListener("change", applyTheme)
      disposeChat?.()
      disposeChat = undefined
      container.remove()
    },
  }
}
