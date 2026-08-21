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
  /** Schema of the agent-supplied props; passed to the agent verbatim. */
  parameters?: WidgetParameters
  /**
   * Draws the widget with the agent-chosen props into `container`, a light-DOM child of the mount
   * target that the chat projects into the conversation. May return a cleanup function, called
   * before the widget is rendered again and when the chat unmounts.
   */
  render: (props: Record<string, unknown>, container: HTMLElement) => (() => void) | void
}

export interface MountAstralBeamChatOptions {
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
}

export interface AstralBeamChatHandle {
  unmount: () => void
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
  let unmounted = false
  let disposeChat: (() => void) | undefined
  import("./chat/index.tsx").then(({ renderChat }) => {
    if (!unmounted) disposeChat = renderChat(shadowRoot, options)
  })
  return {
    unmount: () => {
      unmounted = true
      disposeChat?.()
      disposeChat = undefined
    },
  }
}
