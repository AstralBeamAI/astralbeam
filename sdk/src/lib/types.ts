// Public types of the client entry, re-exported by src/client.ts. Type-only, so the
// chat chunk may import them freely without pulling runtime code across the boundary.

// Minimal Standard Schema interface, vendored as the spec suggests: just enough to
// accept any spec-compliant validator (Zod, Valibot, ArkType, ...) without a dependency.
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => unknown
    /** Type-level only; the spec keeps it undefined at runtime. */
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}

/**
 * Input type `defineTool`/`defineWidget` derive from a `parameters` schema: a Standard Schema's
 * validated output, or untyped props for a plain JSON Schema, which nothing validates in the browser.
 */
// deno-lint-ignore no-explicit-any -- `any` matches any schema input variance-free; `unknown` would not.
export type InferParameters<S extends ParametersSchema> = S extends StandardSchemaV1<any, infer O>
  ? O
  : Record<string, unknown>

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
   * Forwarded verbatim as the tool definition's metadata. A string `title` labels the tool's
   * transcript entry instead of its registry name (`refresh_invoices` reads as "Refresh invoices").
   */
  metadata?: Record<string, unknown> | undefined
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

/**
 * Limits and accepted types for the composer's file attachments. Every field is optional;
 * omitting the whole option leaves attachments enabled with the defaults below.
 */
export interface AstralBeamChatAttachmentOptions {
  /** Hides the attach button (and ignores drops and pastes) when `false`. Default `true`. */
  enabled?: boolean | undefined
  /** How many files one message may carry. Default `5`. */
  maxFiles?: number | undefined
  /**
   * Ceiling for a single file, in bytes. The widget also applies its own per-kind caps
   * (5 MB image, 10 MB PDF, 1 MB text file), so the smaller of the two wins.
   */
  maxFileBytes?: number | undefined
  /** Ceiling for all files on one message, in bytes. Default 20 MB. */
  maxTotalBytes?: number | undefined
  /**
   * Narrows what the composer takes, as MIME types or `type/*` patterns (`["image/*"]` for
   * images only). Omit to accept everything the chat endpoint supports: PNG, JPEG, WebP and
   * GIF images, PDFs, and text files (which the endpoint reads as text for the agent).
   */
  accept?: readonly string[] | undefined
}

/**
 * Draws host content into `container`, a light-DOM element the widget projects into the
 * named area. May return a cleanup, called when the slot is replaced and on unmount.
 */
export type AstralBeamChatSlotRenderer = (container: HTMLElement) => (() => void) | void

/** Host-rendered replacements for the widget's own chrome; each renders in the host page's style. */
export interface AstralBeamChatSlots {
  /** Replaces the header's content (title and reset button); `showHeader: false` still hides the row. */
  header?: AstralBeamChatSlotRenderer | undefined
  /** Replaces the empty-transcript state (icon, headline, and subtitle). */
  empty?: AstralBeamChatSlotRenderer | undefined
  /** Extra controls at the end of the composer's button row, next to send. */
  composerActions?: AstralBeamChatSlotRenderer | undefined
}

/** Color scheme of the chat widget; `"system"` follows the OS `prefers-color-scheme` setting. */
export type AstralBeamChatColorScheme = "light" | "dark" | "system"

/** Overrides for the widget's theming CSS variables, keyed by custom-property name (`"--primary"`). */
export type AstralBeamChatThemeVariables = Record<`--${string}`, string>

/**
 * Custom values for the CSS variables the widget's shadcn theme exposes (`--background`,
 * `--primary`, `--radius`, and the `--font-sans`/`--font-heading`/`--font-mono` stacks, ...),
 * mirroring shadcn's `:root`/`.dark` split: `light` is the base applied in both color schemes,
 * and `dark` overrides it when the resolved scheme is dark.
 */
export interface AstralBeamChatTheme {
  light?: AstralBeamChatThemeVariables | undefined
  dark?: AstralBeamChatThemeVariables | undefined
}

export interface MountAstralBeamChatOptions {
  /**
   * Public ID of the organization-owned agent, fixed for this mounted chat. Omit it to use the
   * organization's default agent, which the dashboard's agents page selects.
   */
  agentId?: string | undefined
  /** Name shown in the widget's header. Default `"AstralBeam"`. */
  title?: string | undefined
  /**
   * Shows the widget's header, which carries the title and the reset button. `false` hides both
   * and gives the transcript the full height. Default `true`.
   */
  showHeader?: boolean | undefined
  /** Headline shown on the empty transcript. Default `"Ask the assistant"`. */
  emptyTitle?: string | undefined
  /** Subtitle shown under the empty transcript's headline. Default describes the app's tools and widgets. */
  emptyDescription?: string | undefined
  /**
   * Base URL of the AstralBeam API; the widget calls `/chat` and its subroutes under it. Fixed at
   * mount. Default `"https://app.astralbeam.ai/api"`, the hosted cloud; self-hosted deployments
   * must set their own origin.
   */
  apiUrl?: string | undefined
  /** Application endpoint that mints a short-lived chat JWT. Fixed at mount. Default `"/api/astralbeam/token"`. */
  authTokenUrl?: string | undefined
  /**
   * Mints the chat JWT in host code instead of letting the widget POST `authTokenUrl` with the
   * page's cookies, for hosts whose backend sits on another origin behind bearer or custom-header
   * auth. Called again whenever the widget needs a token (near expiry, or after one is rejected),
   * so it must mint a fresh token rather than return a memoized one. Fixed at mount.
   */
  getAuthToken?: (() => string | Promise<string>) | undefined
  /** Host-defined tools the agent can call, executed in the host page, keyed by tool name. */
  tools?: Record<string, ToolDefinition> | undefined
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition>
  /** Host-rendered replacements for parts of the widget's chrome; see `AstralBeamChatSlots`. */
  slots?: AstralBeamChatSlots | undefined
  /**
   * Shows the collected sandbox panel (every file the agent wrote, with downloads, and the full
   * command log) above the composer once the sandbox has done work. Off by default: the
   * transcript already shows each step where it happened. Default `false`.
   */
  sandboxPanel?: boolean | undefined
  /**
   * File attachments in the composer, on by default. `false` turns them off; an options object
   * narrows the limits and accepted types.
   */
  attachments?: boolean | AstralBeamChatAttachmentOptions | undefined
  /** Color scheme of the widget. Default `"system"`. */
  colorScheme?: AstralBeamChatColorScheme
  /** Custom values for the widget's theming CSS variables, per color scheme. */
  theme?: AstralBeamChatTheme | undefined
  /**
   * Logs every SDK action to the browser console with UTC timestamps and full payloads,
   * and asks the endpoint (via the forwarded props) to log its side of the run too.
   */
  debug?: boolean | undefined
}

/**
 * Mount options the handle can change afterwards. The agent and the transport URLs are fixed:
 * changing any of them would mean a new client and a discarded transcript.
 */
export type AstralBeamChatUpdate = Partial<
  Omit<MountAstralBeamChatOptions, "agentId" | "apiUrl" | "authTokenUrl" | "getAuthToken">
>

export interface AstralBeamChatHandle {
  unmount: () => void
  /**
   * Merges option changes into the live mount options and applies them in place, keeping the
   * transcript, the chat session, and live widget renders. Only the keys given are replaced.
   */
  update: (options: AstralBeamChatUpdate) => void
  /** Clears the conversation: transcript, drafts, attachments, and live widget renders. */
  reset: () => void
  /** Stops the in-flight generation, if any; the transcript keeps what already streamed. */
  stop: () => void
}
