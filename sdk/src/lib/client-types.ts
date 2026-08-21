// Public types of the client entry, re-exported by src/client.ts. Type-only, so the
// chat chunk may import them freely without pulling runtime code across the boundary.

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
