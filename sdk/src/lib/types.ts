import type { AstralBeamChatCore } from "../core/session.ts"

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
export type InferParameters<S extends ParametersSchema> =
  S extends StandardSchemaV1<unknown, infer O> ? O : Record<string, unknown>

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
  execute: (input: Record<string, unknown>) => unknown
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
  /** Replaces the header's title; `showHeader: false` still hides the row. */
  header?: AstralBeamChatSlotRenderer | undefined
  /** Extra controls at the end of the header, after the history and new chat buttons. */
  headerActions?: AstralBeamChatSlotRenderer | undefined
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
 * A token endpoint to call: `{ url, ...init }`, which the widget calls as `fetch(url, init)` with
 * this object's remaining, standard `RequestInit` fields. The init defaults to `POST`,
 * `credentials: "include"`, `cache: "no-store"`, and an `accept: application/json` header, each
 * overridable here, and the response is expected to carry `{ token }` as JSON.
 */
export interface AstralBeamTokenRequest extends RequestInit {
  url: string
}

/** Retrieves a server-minted token on acquisition and renewal, including after a token rejection.
 * Returning undefined or throwing fails authentication closed. The composer's retry link asks again. */
export type AstralBeamTokenSource =
  | AstralBeamTokenRequest
  | (() => { token: string } | undefined | Promise<{ token: string } | undefined>)

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

/**
 * Every option of the drop-in chat widget, and the one documented source the React props and the
 * headless core options are derived from. Each is optional and accepts an explicit `undefined`, so
 * a host with `exactOptionalPropertyTypes` can pass a value it does not have yet.
 */
export interface MountAstralBeamChatOptions {
  /** Reuses a session owned by the host. Configure authentication and tools on that session. */
  chat?: AstralBeamChatCore | undefined
  /**
   * Public ID of the organization-owned agent. Omit it to use the organization's default agent,
   * which the dashboard's agents page selects. Saved conversations keep their agent.
   * Changing this also switches the local session unless `placementKey` is explicit.
   */
  agentId?: string | undefined
  /** Defaults to `"auto"`, restoring this tab's selection. Use `"new"` for a fresh chat, or a saved thread UUID. */
  threadId?: string | undefined
  /** Local persistence key for this chat placement. Defaults to `agentId`, then `"default"`. */
  placementKey?: string | undefined
  /** Name shown in the widget's header. Default `"AstralBeam"`. */
  title?: string | undefined
  /**
   * Shows the widget's header, which carries the title and the chat history and new chat buttons.
   * `false` hides it and gives the transcript the full height. Default `true`.
   */
  showHeader?: boolean | undefined
  /** Enables horizontal resizing. Height always fills the host. Default `true`. */
  resizable?: boolean | undefined
  /** Default width in CSS pixels, or `"100%"` for available width. Saved widths take precedence. */
  defaultWidth?: number | "100%" | undefined
  /** Stable available-width container for nested layouts. Defaults to the mount target's parent. */
  resizeContainer?: (() => HTMLElement | null) | undefined
  /** Adds an X button and fullscreen chat at widths up to 900px. The host hides or unmounts chat in this callback. */
  onClose?: (() => void) | undefined
  /**
   * Shows a bar under the header with the open conversation's title, once it has one, and a menu
   * to rename, delete, or copy it as Markdown. Default `false`.
   */
  showConversationTitle?: boolean | undefined
  /** Headline shown on the empty transcript. Default `"Ask the assistant"`. */
  emptyHeadline?: string | undefined
  /** Subtitle shown under the empty transcript's headline. Default describes the app's tools and widgets. */
  emptyDescription?: string | undefined
  /**
   * Base URL of the AstralBeam API; the widget calls `/v1/chat` and its subroutes under it. Read for
   * every request, so a change moves the next one. Default `"https://astralbeam.ai/api"`, the
   * hosted cloud; self-hosted deployments must set their own origin.
   */
  apiUrl?: string | undefined
  /** Endpoint or callback retrieving a server-minted token, read on each acquisition and renewal.
   * Defaults to POST /api/astralbeam/token with the page's cookies. Never expose API keys here. */
  fetchAstralBeamToken?: AstralBeamTokenSource | undefined
  /** Host-defined tools the agent can call, executed in the host page, keyed by tool name. */
  tools?: Record<string, ToolDefinition> | undefined
  /** Host-defined widgets the agent can render inline in the conversation, keyed by identifier. */
  widgets?: Record<string, WidgetDefinition> | undefined
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
  colorScheme?: AstralBeamChatColorScheme | undefined
  /** Custom values for the widget's theming CSS variables, per color scheme. */
  theme?: AstralBeamChatTheme | undefined
  /** Trusted application CSS, scoped to this widget's shadow root. */
  customCss?: string | undefined
  /**
   * Logs every SDK action to the browser console with UTC timestamps and full payloads,
   * and asks the endpoint (via the forwarded props) to log its side of the run too.
   */
  debug?: boolean | undefined
}

/** Updates only supplied options. Presentation changes preserve chat.
 * Changing apiUrl clears the previous session, while threadId selects a conversation. */
export type AstralBeamChatUpdate = Partial<MountAstralBeamChatOptions>

export interface AstralBeamChatHandle {
  unmount: () => void
  /** Applies supplied options in place. Presentation changes preserve chat.
   * Changing apiUrl clears the previous session, while threadId selects a conversation. */
  update: (options: AstralBeamChatUpdate) => void
}
