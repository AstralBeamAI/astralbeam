// Public types of the client entry, re-exported by src/client/index.ts. Type-only, so the
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
 * Input type `defineTool`/`defineWidget` derive from an input schema: a Standard Schema's
 * validated output, or untyped props for a plain JSON Schema.
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
  description: string
  /**
   * Forwarded to the agent as JSON Schema. Both JSON Schema and Standard Schema validate input before rendering.
   */
  parameters?: ParametersSchema
  /**
   * Draws validated props into `container`, with invocation context as the third argument.
   * Return cleanup, or an update handle that preserves the presentation.
   */
  render(
    props: Record<string, unknown>,
    container: HTMLElement,
    context: WidgetContext,
  ): WidgetRenderHandle | (() => void) | void
}

export type WidgetRegistry = Readonly<Record<string, WidgetDefinition>>

export interface WidgetRenderHandle<
  Input = Record<string, unknown>,
  Tools extends ToolRegistry = ToolRegistry,
> {
  update(this: void, context: WidgetContext<Input, Tools>): void
  dispose: () => void
}

export interface ToolResult<Output = Record<string, unknown>> {
  /** Model-safe content, also useful when no widget renderer is available. */
  content: readonly ToolContent[]
  /** Model-safe data validated against outputSchema. */
  structuredContent?: Output
  /** Widget data excluded from model context, including saved history. */
  uiData?: Record<string, unknown>
  isError?: boolean
}

/** Protocol-neutral content blocks. Additional JSON fields retain media/resource metadata. */
export interface ToolContent {
  type: string
  text?: string
  [key: string]: unknown
}

export interface ToolExecutionContext {
  readonly signal: AbortSignal
  readonly invocationId?: string
}

export interface WidgetContext<
  Input = Record<string, unknown>,
  Tools extends ToolRegistry = ToolRegistry,
> extends ToolExecutionContext {
  readonly invocationId: string
  input: Input
  result?: ToolResult
  status: "pending" | "complete" | "error" | "cancelled"
  /** Runs an app-visible tool and returns its data or custom result without another assistant response. */
  callTool: <Name extends keyof Tools & string>(
    name: Name,
    ...args: {} extends ToolInput<Tools[Name]>
      ? [input?: ToolInput<Tools[Name]>]
      : [input: ToolInput<Tools[Name]>]
  ) => Promise<Awaited<ReturnType<Tools[Name]["execute"]>>>
}

/** Callers supply schema input, while execute receives its validated output. */
export type ToolInput<Tool extends ToolDefinition> = Tool extends {
  parameters?: infer S extends ParametersSchema
}
  ? S extends StandardSchemaV1<infer Input, unknown>
    ? Input
    : Record<string, unknown>
  : Record<string, unknown>

export interface ToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
  untrustedContentHint?: boolean
  consequentialHint?: boolean
}

export interface ToolDefinition {
  title?: string
  /** Tells the agent what the tool does so it can decide when to call it. */
  description: string
  /** Advisory protocol hints. Authorization remains the application's responsibility. */
  annotations?: ToolAnnotations
  visibility?: readonly ("model" | "app")[]
  /** Identifier of a registered widget presenting this tool's input and result. */
  widget?: string
  /**
   * Forwarded to the agent as JSON Schema. Both JSON Schema and Standard Schema validate input before execution.
   */
  parameters?: ParametersSchema
  outputSchema?: ParametersSchema
  /**
   * Return JSON object data for an automatic envelope, or toolResult(...) for a custom one.
   * A thrown error leaves the outcome unknown because the action may already have run.
   */
  execute(input: Record<string, unknown>, context: ToolExecutionContext): object | Promise<object>
}

export type ToolRegistry = Readonly<Record<string, ToolDefinition>>

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

/**
 * Where the widget's short-lived chat auth token comes from: an endpoint to POST, or a function that
 * mints the token in the host page and returns `{ token }`, optionally as a promise.
 *
 * Either form runs again on every renewal — near expiry and after a token is rejected — so a
 * rotating credential stays current rather than being captured once. A function that returns
 * `undefined`, or throws, fails authentication closed; the composer's retry link asks again.
 */
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
  /**
   * Public ID of the organization-owned agent. Omit it to use the organization's default agent,
   * which the dashboard's agents page selects. Saved conversations keep their agent,
   * and an update applies to new threads.
   */
  agentId?: string | undefined
  /** Defaults to `"auto"`, restoring this tab's selection. Use `"new"` for a fresh chat, or a saved thread UUID. */
  threadId?: string | undefined
  /** Name shown in the widget's header. Default `"AstralBeam"`. */
  title?: string | undefined
  /**
   * Shows the widget's header, which carries the title and the chat history and new chat buttons.
   * `false` hides it and gives the transcript the full height. Default `true`.
   */
  showHeader?: boolean | undefined
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
  /**
   * Where the short-lived chat auth token comes from: `{ url, ...RequestInit }` for a token
   * endpoint, or a function that mints `{ token }` in the host page. Read for every token, so a
   * change applies to the next one, which is minted when the cached token nears expiry. Default
   * `{ url: "/api/astralbeam/token" }`, posted with the page's cookies.
   */
  fetchAstralBeamToken?: AstralBeamTokenSource | undefined
  /** Host-defined tools the agent can call, executed in the host page. */
  tools?: ToolRegistry | undefined
  /** Host-defined widgets the agent can render inline in the conversation. */
  widgets?: WidgetRegistry | undefined
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

/**
 * What the handle's `update` takes: every mount option, none of them fixed. The transport options
 * are re-read per request rather than captured, so changing them keeps the transcript and the
 * chat session instead of forcing a fresh mount.
 */
export type AstralBeamChatUpdate = Partial<MountAstralBeamChatOptions>

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
